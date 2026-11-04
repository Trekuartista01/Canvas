import { putWithProgress } from "@/hooks/use-attachment-upload";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

type Presign = {
  mutateAsync: (input: {
    workspaceId: string;
    fileName: string;
    mime: string;
    sizeBytes: number;
  }) => Promise<{ attachmentId: string; key: string; uploadUrl: string; mime?: string }>;
};
type Confirm = {
  mutateAsync: (input: {
    workspaceId: string;
    attachmentId: string;
    key: string;
    fileName: string;
    mime: string;
  }) => Promise<{ id: string; fileName: string }>;
};

/**
 * Task-less private files (M7.5 leave documents, M7.6 contracts and company
 * documents): presign → direct PUT to storage → confirm, the same flow as
 * task attachments. The caller passes the feature's own presign/confirm
 * mutations, which decide who may upload.
 */
export function usePrivateUpload(workspaceId: string, presign: Presign, confirm: Confirm) {
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File) {
    const reported = file.type || "application/octet-stream";
    const presigned = await presign.mutateAsync({
      workspaceId,
      fileName: file.name,
      mime: reported,
      sizeBytes: file.size,
    });
    const { attachmentId, key, uploadUrl } = presigned;
    // The upload URL is signed for this type, so it has to be the one sent.
    const mime = presigned.mime ?? reported;
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

export function useContractUpload(workspaceId: string) {
  return usePrivateUpload(
    workspaceId,
    trpc.contract.presignUpload.useMutation(),
    trpc.contract.confirmUpload.useMutation(),
  );
}

/** P8.6: several contract files, one after another, with one progress line. */
export function useContractFilesUpload(workspaceId: string) {
  const { upload, progress } = useContractUpload(workspaceId);
  const [position, setPosition] = useState<{ index: number; total: number } | null>(null);

  async function uploadAll(files: File[]) {
    const ids: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setPosition({ index: i + 1, total: files.length });
        ids.push((await upload(file)).id);
      }
    } finally {
      setPosition(null);
    }
    return ids;
  }

  const percent = progress ?? 0;
  const label = position
    ? `Uploading ${position.index} of ${position.total}: ${percent}%`
    : progress !== null
      ? `Uploading ${percent}%`
      : null;
  return { upload, uploadAll, label, percent };
}

export function useCompanyDocumentUpload(workspaceId: string) {
  return usePrivateUpload(
    workspaceId,
    trpc.companyDocument.presignUpload.useMutation(),
    trpc.companyDocument.confirmUpload.useMutation(),
  );
}

/** Follows a short-lived signed link (served as a download, so the page stays put). */
export function openSignedDownload(url: string) {
  window.location.assign(url);
}
