import { db, schema } from "@canvas/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Readable } from "node:stream";
import { uuidv7 } from "uuidv7";
import { can } from "../auth/can";
import { getSessionUser } from "../auth/session";
import { logActivity } from "../lib/activity";
import { sanitizeFilenameForKey, sanitizeForHeader } from "../lib/filename";
import { processImage } from "../lib/image-processing";
import { canViewLeaveDocument } from "../lib/leave";
import { isInlineSafeMimeType, safeContentType } from "../lib/mime-safety";
import { getMembershipRole } from "../lib/membership";
import {
  assertPublicRateLimit,
  clientIp,
  PUBLIC_UPLOAD_RATE_LIMIT_MAX,
  RateLimitError,
} from "../lib/rate-limit";
import { getObject, putObject } from "../lib/storage";
import { requireTask } from "../lib/task-queries";

// Downloads stay a plain streaming REST route (not tRPC — no native
// file-transport support there), permission-checked on every request per
// M1.9's original decision. Task *uploads* moved to
// attachment.presignUpload/confirmUpload (a direct-to-storage flow for
// multi-GB files) and no longer live here — see that router file's
// comments for why. The public, session-less form-completion upload below
// stays a buffered multipart route: those attachments come from an
// external, unauthenticated submitter and are expected to be normal-sized
// deliverables, not multi-GB assets.
export function registerAttachmentRoutes(app: FastifyInstance) {
  // Public, unauthenticated form-completion upload — for a task-bound
  // form's external submitter (form.ts's getPublic/submitPublic never
  // require a session either), gated by the form's own publicToken instead
  // of getSessionUser. Same trust boundary the rest of forms.md's public
  // surface already accepts: anyone with the link can act on it.
  app.post("/public-forms/uploads", async (req, reply) => {
    // Checked before touching the multipart body at all — rejects an
    // abusive IP before spending any bandwidth/CPU parsing a file.
    try {
      await assertPublicRateLimit(`upload:ip:${clientIp(req)}`, PUBLIC_UPLOAD_RATE_LIMIT_MAX);
    } catch (err) {
      if (err instanceof RateLimitError) return reply.code(429).send({ error: err.message });
      throw err;
    }

    let publicToken: string | undefined;
    let file: { buffer: Buffer; filename: string; mimetype: string } | undefined;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        file = { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype };
      } else if (part.fieldname === "publicToken" && typeof part.value === "string") {
        publicToken = part.value;
      }
    }

    if (!publicToken || !file) {
      return reply.code(400).send({ error: "Missing file or publicToken" });
    }

    // A second bucket keyed on the token itself, checked after the parse
    // (once we actually have it) but before any S3 write — catches a
    // single form link being hammered from many rotating IPs, which the
    // IP-only check above can't.
    try {
      await assertPublicRateLimit(`upload:token:${publicToken}`, PUBLIC_UPLOAD_RATE_LIMIT_MAX);
    } catch (err) {
      if (err instanceof RateLimitError) return reply.code(429).send({ error: err.message });
      throw err;
    }

    const form = await db.query.forms.findFirst({
      where: eq(schema.forms.publicToken, publicToken),
    });
    if (!form) return reply.code(404).send({ error: "Form not found" });
    if (!form.taskId) return reply.code(400).send({ error: "This form isn't bound to a task" });

    const task = await requireTask(form.taskId).catch(() => null);
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const attachmentId = uuidv7();
    const originalKey = `attachments/${form.workspaceId}/${attachmentId}/${sanitizeFilenameForKey(file.filename)}`;
    await putObject(originalKey, file.buffer, file.mimetype);

    let thumbKey: string | null = null;
    let blurhash: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (file.mimetype.startsWith("image/")) {
      const processed = await processImage(file.buffer);
      if (processed) {
        thumbKey = `attachments/${form.workspaceId}/${attachmentId}/thumb.webp`;
        await putObject(thumbKey, processed.thumbBuffer, processed.thumbContentType);
        ({ blurhash, width, height } = processed);
      }
    }

    const [attachment] = await db
      .insert(schema.attachments)
      .values({
        id: attachmentId,
        workspaceId: form.workspaceId,
        taskId: form.taskId,
        uploaderId: form.createdBy,
        fileKey: originalKey,
        fileName: file.filename,
        mime: file.mimetype,
        sizeBytes: file.buffer.byteLength,
        thumbKey,
        blurhash,
        width,
        height,
      })
      .returning();
    if (!attachment) return reply.code(500).send({ error: "Failed to save attachment" });

    await logActivity(
      form.workspaceId,
      form.createdBy,
      "attachment",
      attachment.id,
      "attachment.created",
    );

    return reply.send({
      id: attachment.id,
      fileName: attachment.fileName,
      mime: attachment.mime,
      sizeBytes: attachment.sizeBytes,
    });
  });

  app.get<{ Params: { attachmentId: string }; Querystring: { download?: string } }>(
    "/uploads/:attachmentId",
    (req, reply) => streamAttachment(req, reply, "file"),
  );

  app.get<{ Params: { attachmentId: string } }>("/uploads/:attachmentId/thumb", (req, reply) =>
    streamAttachment(req, reply, "thumb"),
  );
}

async function streamAttachment(
  req: FastifyRequest<{ Params: { attachmentId: string }; Querystring?: { download?: string } }>,
  reply: FastifyReply,
  kind: "file" | "thumb",
) {
  const user = await getSessionUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });

  const attachment = await db.query.attachments.findFirst({
    where: eq(schema.attachments.id, req.params.attachmentId),
  });
  if (!attachment) return reply.code(404).send({ error: "Not found" });

  const role = await getMembershipRole(attachment.workspaceId, user.id);
  if (!can(user, "attachment:view", { type: "workspace", role })) {
    return reply.code(403).send({ error: "Forbidden" });
  }
  // M7.5: a leave document (doctor's note) is private to the employee and
  // whoever may approve their leave, not the whole workspace.
  if ((await canViewLeaveDocument(user, attachment)) === false) {
    return reply.code(403).send({ error: "Forbidden" });
  }
  const key = kind === "thumb" ? attachment.thumbKey : attachment.fileKey;
  if (!key) return reply.code(404).send({ error: "Not found" });

  const object = await getObject(key);
  const rawContentType = object.ContentType ?? attachment.mime;
  // Thumbnails are always server-generated (processImage → webp), so their
  // content type is trustworthy regardless; the original "file" upload's
  // mime came straight from the uploader's multipart request and is never
  // verified against the actual bytes — serving it back with that claimed
  // type, inline, is a stored-XSS vector (upload text/html or
  // image/svg+xml with a <script>, then open the file's direct URL).
  const inlineSafe = kind === "thumb" || isInlineSafeMimeType(rawContentType);
  reply.header("Content-Type", inlineSafe ? rawContentType : safeContentType(rawContentType));
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Cache-Control", "private, max-age=3600");
  // Video playback (M4.6 clips) needs a known length upfront to report
  // duration/seek correctly — images/other files get it for free too.
  if (object.ContentLength !== undefined) {
    reply.header("Content-Length", String(object.ContentLength));
  }
  if (kind === "file") {
    const disposition = req.query?.download || !inlineSafe ? "attachment" : "inline";
    reply.header(
      "Content-Disposition",
      `${disposition}; filename="${sanitizeForHeader(attachment.fileName)}"`,
    );
  }
  return reply.send(object.Body as Readable);
}
