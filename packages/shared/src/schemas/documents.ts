import { z } from "zod";
import {
  CONTRACT_KINDS,
  MAX_CONTRACT_FILE_BYTES,
  MAX_CONTRACT_FILES_PER_UPLOAD,
  contractFileMime,
} from "../documents";
import { CONTRACT_TYPES } from "../people";

const workspaceId = z.string().uuid();
const title = z.string().trim().min(1).max(200);

// Contracts, annexes and policy PDFs — generous, but nowhere near the
// multi-GB task-attachment cap.
export const MAX_DOCUMENT_BYTES = 50 * 1024 ** 2;

// M7.6 private uploads (contracts / company documents) — the same
// presign → PUT → confirm flow as task attachments.
export const presignDocumentSchema = z.object({
  workspaceId,
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
});

export const confirmDocumentSchema = z.object({
  workspaceId,
  attachmentId: z.string().uuid(),
  key: z.string().min(1),
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200),
});

export const createContractSchema = z.object({
  workspaceId,
  userId: z.string().uuid(),
  kind: z.enum(CONTRACT_KINDS),
  // Required for an annex/amendment (the contract it belongs to) — server-checked.
  parentContractId: z.string().uuid().nullable().optional(),
  title,
  contractType: z.enum(CONTRACT_TYPES).nullable().optional(),
  startDate: z.string().date(),
  expiryDate: z.string().date().nullable().optional(),
  // P8.6: every page/file of the contract, uploaded first, in order.
  attachmentIds: z.array(z.string().uuid()).min(1).max(MAX_CONTRACT_FILES_PER_UPLOAD),
});

export const updateContractSchema = z.object({
  contractId: z.string().uuid(),
  title: title.optional(),
  contractType: z.enum(CONTRACT_TYPES).nullable().optional(),
  startDate: z.string().date().optional(),
  expiryDate: z.string().date().nullable().optional(),
});

export const contractIdSchema = z.object({ contractId: z.string().uuid() });

export const contractsForPersonSchema = z.object({ workspaceId, userId: z.string().uuid() });

// P8.6: a contract file — JPG/PNG/HEIC/PDF, ≤ 20 MB (checked again on confirm).
export const presignContractFileSchema = z
  .object({
    workspaceId,
    fileName: z.string().trim().min(1).max(300),
    mime: z.string().trim().max(200),
    sizeBytes: z.number().int().positive().max(MAX_CONTRACT_FILE_BYTES, "Files can be up to 20 MB"),
  })
  .refine((v) => contractFileMime(v.fileName, v.mime) !== null, {
    message: "Contracts can be JPG, PNG, HEIC or PDF",
    path: ["fileName"],
  });

export const addContractFilesSchema = z.object({
  contractId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).min(1).max(MAX_CONTRACT_FILES_PER_UPLOAD),
});

export const replaceContractFileSchema = z.object({
  fileId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

export const contractFileIdSchema = z.object({ fileId: z.string().uuid() });

export const contractFileUrlSchema = z.object({
  fileId: z.string().uuid(),
  // inline = the full-screen preview; download = saved under its own name.
  disposition: z.enum(["inline", "download"]),
});

export const documentCategorySchema = z.object({
  workspaceId,
  name: z.string().trim().min(1).max(80),
});

export const renameDocumentCategorySchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

export const documentCategoryIdSchema = z.object({ categoryId: z.string().uuid() });

export const createCompanyDocumentSchema = z.object({
  workspaceId,
  categoryId: z.string().uuid().nullable(),
  title,
  attachmentId: z.string().uuid(),
});

export const updateCompanyDocumentSchema = z.object({
  documentId: z.string().uuid(),
  title: title.optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

export const replaceCompanyDocumentSchema = z.object({
  documentId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

export const companyDocumentIdSchema = z.object({ documentId: z.string().uuid() });

export const companyDocumentDownloadSchema = z.object({
  documentId: z.string().uuid(),
  // A specific older version; omitted = the current one.
  versionId: z.string().uuid().optional(),
});
