import { db, schema } from "@canvas/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { logActivity } from "./activity";
import { sanitizeFilenameForKey } from "./filename";
import { getPresignedUploadUrl, getPresignedUrl, headObject } from "./storage";

/**
 * Task-less files (leave documents, contracts, company documents) use the
 * same direct-to-storage presign → PUT → confirm flow as task attachments.
 * The key prefix is what marks the kind of file, and decides who may
 * download it (see canViewPrivateAttachment in lib/private-attachments.ts).
 */
export const PRIVATE_PREFIXES = {
  leave: "leave-documents/",
  contract: "contracts/",
  companyDocument: "company-documents/",
} as const;
export type PrivatePrefix = (typeof PRIVATE_PREFIXES)[keyof typeof PRIVATE_PREFIXES];

export async function presignPrivateUpload(
  prefix: PrivatePrefix,
  input: { workspaceId: string; fileName: string; mime: string },
) {
  const attachmentId = uuidv7();
  const key = `${prefix}${input.workspaceId}/${attachmentId}/${sanitizeFilenameForKey(input.fileName)}`;
  return { attachmentId, key, uploadUrl: await getPresignedUploadUrl(key, input.mime) };
}

export async function confirmPrivateUpload(
  prefix: PrivatePrefix,
  uploaderId: string,
  input: { workspaceId: string; attachmentId: string; key: string; fileName: string; mime: string },
) {
  // The key must be the one presign handed out for this workspace + id.
  if (!input.key.startsWith(`${prefix}${input.workspaceId}/${input.attachmentId}/`)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unexpected upload key" });
  }
  const head = await headObject(input.key);
  if (!head) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload did not complete" });
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
  return { id: attachment.id, fileName: attachment.fileName };
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
 * A short-lived signed download link — the caller has already checked
 * permission. Served as an attachment with the original file name.
 */
export async function signedDownloadUrl(attachmentId: string) {
  const attachment = await db.query.attachments.findFirst({
    where: eq(schema.attachments.id, attachmentId),
  });
  if (!attachment?.fileKey) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    url: await getPresignedUrl(attachment.fileKey, 120, attachment.fileName),
    fileName: attachment.fileName,
  };
}
