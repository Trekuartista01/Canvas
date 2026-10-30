import { z } from "zod";

export const listAttachmentsSchema = z.object({
  taskId: z.string().uuid(),
});

// A sanity ceiling on the presigned-upload flow below, not a technical
// limit — direct-to-storage uploads no longer pass through the API's
// memory at all, so this exists only to stop a garbage/malicious request
// from minting a signed URL for an absurd size. Comfortably above the
// "a few GB" 3D/video assets this flow was built for.
export const MAX_ATTACHMENT_UPLOAD_BYTES = 20 * 1024 ** 3;

// Large-file uploads (3D assets, clips) go straight from the browser to
// S3/MinIO instead of through the API — see storage.ts's
// getPresignedUploadUrl. `presignUpload` authorizes the upload and mints a
// short-lived signed PUT url for one exact object key; `confirmUpload`
// re-checks permission, verifies the object actually landed in storage
// (via a HEAD request — never trusts the client's say-so), and only then
// creates the `attachments` row. No file bytes ever pass through a tRPC
// procedure; those are both plain JSON in/out.
export const presignUploadSchema = z.object({
  taskId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_UPLOAD_BYTES),
});

export const confirmUploadSchema = z.object({
  attachmentId: z.string().uuid(),
  key: z.string().min(1),
  taskId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200),
  // M7.2: upload straight into the task's proof (images only).
  isProof: z.boolean().optional(),
});

export const deleteAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
});

// M5.6: attaching a Google Drive file by its share link (see PROGRESS.md
// — the "picker" widget itself needs frontend-exposed OAuth/API-key
// plumbing this repo doesn't have yet; this is the always-available path,
// and the one the real Picker would feed into once configured). A plain
// tRPC mutation, unlike upload — no file bytes cross the wire, just the
// Drive file's own metadata.
export const attachExternalSchema = z.object({
  taskId: z.string().uuid(),
  url: z.string().trim().url(),
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200).optional(),
});

// M7.2: mark/unmark an existing image attachment as proof of work.
export const setAttachmentProofSchema = z.object({
  attachmentId: z.string().uuid(),
  isProof: z.boolean(),
});
