import { db, schema } from "@canvas/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { logActivity } from "./activity";
import { sanitizeFilenameForKey } from "./filename";
import { processImage } from "./image-processing";
import {
  deleteObject,
  getObject,
  getPresignedUploadUrl,
  getPresignedUrl,
  headObject,
  putObject,
  uploadedTypeMatches,
} from "./storage";

/** Spec §1: HR files are only reachable through 5-minute signed links. */
export const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Task-less files (leave documents, contracts, company documents) use the
 * same direct-to-storage presign → PUT → confirm flow as task attachments.
 * The key prefix is what marks the kind of file, and decides who may
 * download it (see canViewPrivateAttachment in lib/private-attachments.ts).
 */
export const PRIVATE_PREFIXES = {
  leave: "leave-documents/",
  // P8.6: hr/contracts/{workspace}/{uuidv7}/… (spec §1). Files from before
  // P8.6 stay under LEGACY_CONTRACT_PREFIX; both are HR files.
  contract: "hr/contracts/",
  companyDocument: "company-documents/",
  // P8.10: shown through signed links from the client router, Ops/CEO/Admin only.
  clientLogo: "client-logos/",
} as const;
export const LEGACY_CONTRACT_PREFIX = "contracts/";

/** HR files: never streamed by /uploads, only handed out as signed links. */
export function isHrFileKey(key: string) {
  return key.startsWith("hr/") || key.startsWith(LEGACY_CONTRACT_PREFIX);
}
export type PrivatePrefix = (typeof PRIVATE_PREFIXES)[keyof typeof PRIVATE_PREFIXES];

export async function presignPrivateUpload(
  prefix: PrivatePrefix,
  input: { workspaceId: string; fileName: string; mime: string },
) {
  const attachmentId = uuidv7();
  const key = `${prefix}${input.workspaceId}/${attachmentId}/${sanitizeFilenameForKey(input.fileName)}`;
  return { attachmentId, key, uploadUrl: await getPresignedUploadUrl(key, input.mime) };
}

export interface ConfirmOptions {
  /** Refuse (and delete) an object larger than this. */
  maxBytes?: number;
  /** Make a webp thumbnail + blurhash next to an image (contract photos). */
  thumbnail?: boolean;
}

async function bufferFromStream(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function confirmPrivateUpload(
  prefix: PrivatePrefix,
  uploaderId: string,
  input: { workspaceId: string; attachmentId: string; key: string; fileName: string; mime: string },
  options: ConfirmOptions = {},
) {
  // The key must be the one presign handed out for this workspace + id.
  if (!input.key.startsWith(`${prefix}${input.workspaceId}/${input.attachmentId}/`)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unexpected upload key" });
  }
  const head = await headObject(input.key);
  if (!head) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload did not complete" });
  if (!uploadedTypeMatches(head.ContentType, input.mime)) {
    await deleteObject(input.key);
    throw new TRPCError({ code: "BAD_REQUEST", message: "The file arrived as a different type" });
  }
  if (options.maxBytes !== undefined && (head.ContentLength ?? 0) > options.maxBytes) {
    await deleteObject(input.key);
    throw new TRPCError({ code: "BAD_REQUEST", message: "The file is too large" });
  }
  let thumb: { thumbKey: string; blurhash: string; width: number; height: number } | null = null;
  if (options.thumbnail && input.mime.startsWith("image/")) {
    const object = await getObject(input.key);
    const processed = await processImage(await bufferFromStream(object.Body));
    if (processed) {
      const thumbKey = `${prefix}${input.workspaceId}/${input.attachmentId}/thumb.webp`;
      await putObject(thumbKey, processed.thumbBuffer, processed.thumbContentType);
      thumb = {
        thumbKey,
        blurhash: processed.blurhash,
        width: processed.width,
        height: processed.height,
      };
    }
  }
  const [attachment] = await db
    .insert(schema.attachments)
    .values({
      id: input.attachmentId,
      workspaceId: input.workspaceId,
      uploaderId,
      fileKey: input.key,
      fileName: input.fileName,
      mime: input.mime,
      sizeBytes: head.ContentLength ?? 0,
      ...(thumb ?? {}),
    })
    .returning();
  if (!attachment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  await logActivity(
    input.workspaceId,
    uploaderId,
    "attachment",
    attachment.id,
    "attachment.created",
    {
      private: prefix,
    },
  );
  return { id: attachment.id, fileName: attachment.fileName, mime: attachment.mime };
}

/**
 * An uploaded file that's about to be linked to a record: it must exist in
 * this workspace, have this prefix, and (optionally) come from `uploaderId`.
 */
export async function requirePrivateAttachment(
  prefix: PrivatePrefix,
  workspaceId: string,
  attachmentId: string,
  uploaderId?: string,
) {
  const attachment = await db.query.attachments.findFirst({
    where: eq(schema.attachments.id, attachmentId),
  });
  if (
    !attachment ||
    attachment.workspaceId !== workspaceId ||
    !attachment.fileKey?.startsWith(prefix) ||
    (uploaderId !== undefined && attachment.uploaderId !== uploaderId)
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That file can't be used here" });
  }
  return attachment;
}

/**
 * A short-lived (5-minute) signed link — the caller has already checked
 * permission. By default served as an attachment with the original file
 * name; `inline` is for previews (only JPG/PNG/PDF render inline, which
 * presign/confirm already restricted contract files to).
 */
export async function signedDownloadUrl(
  attachmentId: string,
  disposition: "download" | "inline" = "download",
) {
  const attachment = await db.query.attachments.findFirst({
    where: eq(schema.attachments.id, attachmentId),
  });
  if (!attachment?.fileKey) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    url: await getPresignedUrl(
      attachment.fileKey,
      SIGNED_URL_TTL_SECONDS,
      disposition === "download" ? attachment.fileName : undefined,
    ),
    fileName: attachment.fileName,
  };
}
