import { trpc } from "@/lib/trpc";
import { useState } from "react";

export type AttachmentTarget = { taskId: string };

export function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(file);
  });
}

/**
 * Direct browser -> storage upload (attachment.presignUpload +
 * confirmUpload) — file bytes never pass through the API, so this scales
 * to multi-GB files (3D assets, clips) without the server ever buffering
 * anything in memory. Tracks per-file percent progress via XHR (`fetch`
 * has no upload-progress event), since a multi-GB upload can take minutes
 * and a bare "Uploading…" label isn't enough feedback at that size.
 * Shared by task attachments and clips — the two places that used to hit
 * the old buffered `POST /uploads` route.
 */
export function useAttachmentUpload() {
  const presign = trpc.attachment.presignUpload.useMutation();
  const confirm = trpc.attachment.confirmUpload.useMutation();
  const [progress, setProgress] = useState<Record<string, number>>({});

  // `opts.isProof` (M7.2): the photo goes straight into the task's proof.
  async function uploadFile(file: File, target: AttachmentTarget, opts?: { isProof?: boolean }) {
    const mime = file.type || "application/octet-stream";
    const { attachmentId, key, uploadUrl } = await presign.mutateAsync({
      ...target,
      fileName: file.name,
      mime,
      sizeBytes: file.size,
    });

    setProgress((p) => ({ ...p, [attachmentId]: 0 }));
    try {
      await putWithProgress(uploadUrl, file, mime, (pct) =>
        setProgress((p) => ({ ...p, [attachmentId]: pct })),
      );
      return await confirm.mutateAsync({
        attachmentId,
        key,
        ...target,
        fileName: file.name,
        mime,
        isProof: opts?.isProof,
      });
    } finally {
      setProgress((p) => {
        const next = { ...p };
        delete next[attachmentId];
        return next;
      });
    }
  }

  return { uploadFile, progress };
}
