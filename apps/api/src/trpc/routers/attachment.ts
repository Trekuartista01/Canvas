import { db, schema } from "@canvas/db";
import {
  attachExternalSchema,
  confirmUploadSchema,
  deleteAttachmentSchema,
  listAttachmentsSchema,
  presignUploadSchema,
  setAttachmentProofSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { logActivity } from "../../lib/activity";
import { requireAttachmentTarget } from "../../lib/attachment-auth";
import { parseDriveLink } from "../../lib/drive-link";
import { processImage } from "../../lib/image-processing";
import { sanitizeFilenameForKey } from "../../lib/filename";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import {
  deleteObject,
  getObject,
  getPresignedUploadUrl,
  headObject,
  putObject,
} from "../../lib/storage";
import { requireTask, workspaceIdForTask } from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

async function bufferFromStream(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export const attachmentRouter = router({
  list: protectedProcedure.input(listAttachmentsSchema).query(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForTask(input.taskId);
    await assertCan(ctx.user, workspaceId, "attachment:view");

    return db.query.attachments.findMany({
      where: eq(schema.attachments.taskId, input.taskId),
      orderBy: asc(schema.attachments.createdAt),
    });
  }),

  delete: protectedProcedure.input(deleteAttachmentSchema).mutation(async ({ ctx, input }) => {
    const attachment = await db.query.attachments.findFirst({
      where: eq(schema.attachments.id, input.attachmentId),
    });
    if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCan(ctx.user, attachment.workspaceId, "attachment:delete");

    await db.delete(schema.attachments).where(eq(schema.attachments.id, attachment.id));
    // A "google_drive" source attachment has no S3 object of its own.
    if (attachment.fileKey) await deleteObject(attachment.fileKey);
    if (attachment.thumbKey) await deleteObject(attachment.thumbKey);

    await logActivity(
      attachment.workspaceId,
      ctx.user.id,
      "attachment",
      attachment.id,
      "attachment.deleted",
    );

    // Same reuse-the-task-event trick confirmUpload below uses — without
    // this, a deleted attachment stays visible to every other connected
    // client until they reload.
    if (attachment.taskId) {
      const task = await requireTask(attachment.taskId);
      await publish(attachment.workspaceId, {
        entity: "task",
        id: attachment.taskId,
        listId: task.listId,
        kind: "updated",
      });
    }
    return { id: attachment.id };
  }),

  // Direct-to-storage upload, step 1 of 2 — see packages/shared's
  // presignUploadSchema for the full reasoning. Never touches the
  // database; a browser that gets a URL and never uses it just leaves an
  // unreferenced (harmless, cheap) object in the bucket, not a phantom
  // attachment row.
  presignUpload: protectedProcedure.input(presignUploadSchema).mutation(async ({ ctx, input }) => {
    const { workspaceId } = await requireAttachmentTarget(ctx.user, { taskId: input.taskId });

    const attachmentId = uuidv7();
    const key = `attachments/${workspaceId}/${attachmentId}/${sanitizeFilenameForKey(input.fileName)}`;
    const uploadUrl = await getPresignedUploadUrl(key, input.mime);

    return { attachmentId, key, uploadUrl };
  }),

  // Step 2 — re-checks permission (never trust that a confirm call came
  // from the same session that got the presigned URL), verifies the
  // object actually landed in storage rather than trusting the client's
  // word for it, and only then creates the attachments row. Image
  // thumbnailing needs the real bytes, so for images this downloads the
  // object back from storage to run the same processImage() the old
  // buffered-upload route used inline — a cost only image uploads pay;
  // the large 3D/video files this flow exists for never hit this branch.
  confirmUpload: protectedProcedure.input(confirmUploadSchema).mutation(async ({ ctx, input }) => {
    const { workspaceId } = await requireAttachmentTarget(ctx.user, { taskId: input.taskId });
    if (input.isProof && !input.mime.startsWith("image/")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Proof must be a photo" });
    }

    const head = await headObject(input.key);
    if (!head) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Upload did not complete" });
    }

    let thumbKey: string | null = null;
    let blurhash: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (input.mime.startsWith("image/")) {
      const object = await getObject(input.key);
      const buffer = await bufferFromStream(object.Body);
      const processed = await processImage(buffer);
      if (processed) {
        thumbKey = `attachments/${workspaceId}/${input.attachmentId}/thumb.webp`;
        await putObject(thumbKey, processed.thumbBuffer, processed.thumbContentType);
        ({ blurhash, width, height } = processed);
      }
    }

    const [attachment] = await db
      .insert(schema.attachments)
      .values({
        id: input.attachmentId,
        workspaceId,
        taskId: input.taskId,
        uploaderId: ctx.user.id,
        fileKey: input.key,
        fileName: input.fileName,
        mime: input.mime,
        sizeBytes: head.ContentLength ?? 0,
        thumbKey,
        blurhash,
        width,
        height,
        isProof: input.isProof ?? false,
      })
      .returning();
    if (!attachment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(
      workspaceId,
      ctx.user.id,
      "attachment",
      attachment.id,
      "attachment.created",
      attachment.isProof ? { isProof: true } : undefined,
    );

    // Pre-existing gap this touches while it's here: neither the old
    // /uploads route nor this one ever published a realtime event, so
    // an attachment only ever showed up for the person who uploaded it
    // — anyone else viewing the same task needed a manual reload. Reusing
    // the task entity type rather than inventing an "attachment" one: the
    // client's task invalidation branch (use-realtime.ts) also refreshes
    // attachment.list.
    const task = await requireTask(input.taskId);
    await publish(workspaceId, {
      entity: "task",
      id: input.taskId,
      listId: task.listId,
      kind: "updated",
    });

    return attachment;
  }),

  // M7.2: mark an already-uploaded photo as proof of work (or unmark it).
  setProof: protectedProcedure.input(setAttachmentProofSchema).mutation(async ({ ctx, input }) => {
    const attachment = await db.query.attachments.findFirst({
      where: eq(schema.attachments.id, input.attachmentId),
    });
    if (!attachment?.taskId) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCan(ctx.user, attachment.workspaceId, "attachment:create");
    if (input.isProof && !attachment.mime.startsWith("image/")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Proof must be a photo" });
    }

    await db
      .update(schema.attachments)
      .set({ isProof: input.isProof, updatedAt: new Date() })
      .where(eq(schema.attachments.id, attachment.id));
    await logActivity(
      attachment.workspaceId,
      ctx.user.id,
      "attachment",
      attachment.id,
      input.isProof ? "attachment.marked_proof" : "attachment.unmarked_proof",
    );
    const task = await requireTask(attachment.taskId);
    await publish(attachment.workspaceId, {
      entity: "task",
      id: task.id,
      listId: task.listId,
      kind: "updated",
    });
    return { id: attachment.id, isProof: input.isProof };
  }),

  // M5.6 Google Drive "picker": a plain tRPC mutation (unlike /uploads —
  // no file bytes cross the wire, just the Drive file's own link/name/
  // mime), see PROGRESS.md decisions.
  attachExternal: protectedProcedure
    .input(attachExternalSchema)
    .mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForTask(input.taskId);
      await assertCan(ctx.user, workspaceId, "attachment:create");

      const { canonicalUrl } = parseDriveLink(input.url);

      const [attachment] = await db
        .insert(schema.attachments)
        .values({
          workspaceId,
          taskId: task.id,
          uploaderId: ctx.user.id,
          source: "google_drive",
          fileName: input.fileName,
          mime: input.mime ?? "application/vnd.google-apps.file",
          externalUrl: canonicalUrl,
        })
        .returning();
      if (!attachment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        workspaceId,
        ctx.user.id,
        "attachment",
        attachment.id,
        "attachment.created",
        {
          source: "google_drive",
        },
      );
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: task.listId,
        kind: "updated",
      });
      return attachment;
    }),
});
