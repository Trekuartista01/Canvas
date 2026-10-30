import { putWithProgress } from "@/hooks/use-attachment-upload";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

type Presign = {
  mutateAsync: (input: {
    workspaceId: string;
    fileName: string;
    mime: string;
    sizeBytes: number;
  }) => Promise<{ attachmentId: string; key: string; uploadUrl: string }>;
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

export function useContractUpload(workspaceId: string) {
  return usePrivateUpload(
    workspaceId,
    trpc.contract.presignUpload.useMutation(),
    trpc.contract.confirmUpload.useMutation(),
  );
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
