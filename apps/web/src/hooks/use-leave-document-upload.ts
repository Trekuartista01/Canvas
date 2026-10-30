import { putWithProgress } from "@/hooks/use-attachment-upload";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

/**
 * M7.5: a supporting document for a leave request (e.g. a doctor's note) —
 * same direct-to-storage presign → PUT → confirm flow as task attachments,
 * through leave.presignDocument/confirmDocument so the file is private to
 * the employee and their approvers.
 */
export function useLeaveDocumentUpload(workspaceId: string) {
  const presign = trpc.leave.presignDocument.useMutation();
  const confirm = trpc.leave.confirmDocument.useMutation();
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File) {
    const mime = file.type || "application/octet-stream";
    const { attachmentId, key, uploadUrl } = await presign.mutateAsync({
      workspaceId,
      fileName: file.name,
      mime,
      sizeBytes: file.size,
    });
    setProgress(0);
    try {
      await putWithProgress(uploadUrl, file, mime, setProgress);
      return await confirm.mutateAsync({
        workspaceId,
        attachmentId,
        key,
        fileName: file.name,
        mime,
      });
    } finally {
      setProgress(null);
    }
  }

  return { upload, progress };
}
