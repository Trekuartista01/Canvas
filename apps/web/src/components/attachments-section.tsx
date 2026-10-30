import type { AppRouter } from "@canvas/api";
import { BlurhashThumb } from "@/components/blurhash-thumb";
import { Section } from "@/components/detail-field";
import { Lightbox } from "@/components/lightbox";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { formatBytes } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useRef, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Attachment = RouterOutputs["attachment"]["list"][number];

// "google_drive" attachments never have a generated thumb/blurhash (see
// schema/attachments.ts) — even one with an image mimeType goes in the
// plain files list, not the BlurhashThumb grid, since there's no
// /uploads/:id/thumb to load for it.
function isImage(a: Attachment) {
  return a.source === "upload" && a.mime.startsWith("image/");
}

export function AttachmentsSection({ taskId }: { taskId: string }) {
  const utils = trpc.useUtils();
  const attachments = trpc.attachment.list.useQuery({ taskId });
  const invalidate = () => utils.attachment.list.invalidate({ taskId });
  const del = trpc.attachment.delete.useMutation({ onSuccess: invalidate });
  // M7.2: an already-attached photo can count as proof of work.
  const setProof = trpc.attachment.setProof.useMutation({
    onSuccess: () => {
      void invalidate();
      void utils.task.approvalState.invalidate({ taskId });
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { uploadFile, progress } = useAttachmentUpload();

  // M5.6 "Google Drive picker": the always-available paste-link path (see
  // PROGRESS.md — the real Picker widget needs frontend-exposed Google
  // OAuth/API-key plumbing this repo doesn't have configured).
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [driveName, setDriveName] = useState("");
  const [driveError, setDriveError] = useState<string | null>(null);
  const attachDrive = trpc.attachment.attachExternal.useMutation({
    onSuccess: () => {
      invalidate();
      setDriveUrl("");
      setDriveName("");
      setDriveError(null);
      setDriveOpen(false);
    },
    onError: (err) => setDriveError(err.message),
  });

  const all = attachments.data ?? [];
  const images = all.filter(isImage);
  const files = all.filter((a) => !isImage(a));

  // Uploads go straight to storage (attachment.presignUpload/confirmUpload
  // — see use-attachment-upload.ts), not through the API, so a multi-GB
  // file doesn't get buffered whole in the server's memory.
  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(fileList)) {
        await uploadFile(file, { taskId });
      }
      invalidate();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <Section label={`Attachments${all.length ? ` (${all.length})` : ""}`}>
      <div className="space-y-2">
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((a, i) => (
              <div key={a.id} className="group relative">
                <BlurhashThumb attachment={a} onClick={() => setLightboxIndex(i)} />
                <button
                  type="button"
                  aria-pressed={a.isProof}
                  title={a.isProof ? "Unmark as proof" : "Mark as proof"}
                  onClick={() => setProof.mutate({ attachmentId: a.id, isProof: !a.isProof })}
                  className={`bg-background/90 absolute top-1 left-1 rounded-full px-1.5 text-[10px] ${
                    a.isProof
                      ? "text-status-good inline"
                      : "text-muted-foreground hidden group-hover:inline"
                  }`}
                >
                  {a.isProof ? "Proof ✓" : "Mark proof"}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${a.fileName}`}
                  title={`Delete ${a.fileName}`}
                  onClick={() => del.mutate({ attachmentId: a.id })}
                  className="bg-background/90 text-muted-foreground hover:text-foreground absolute top-1 right-1 hidden rounded-full px-1.5 text-xs group-hover:inline"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-1">
            {files.map((a) => (
              <div
                key={a.id}
                className="group border-border flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
              >
                <a
                  href={a.source === "google_drive" ? (a.externalUrl ?? "#") : `/uploads/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 truncate hover:underline"
                >
                  {a.source === "google_drive" ? "📁" : "📎"} {a.fileName}
                </a>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {a.source === "google_drive" ? "Drive" : formatBytes(a.sizeBytes ?? 0)}
                </span>
                <button
                  type="button"
                  aria-label={`Delete ${a.fileName}`}
                  title={`Delete ${a.fileName}`}
                  onClick={() => del.mutate({ attachmentId: a.id })}
                  className="text-muted-foreground hover:text-foreground hidden shrink-0 group-hover:inline"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            aria-label="Upload attachment"
            disabled={uploading}
            onChange={(e) => handleFiles(e.target.files)}
            className="text-muted-foreground text-xs"
          />
          {uploading && (
            <span className="text-muted-foreground text-xs">
              {Object.values(progress)[0] !== undefined
                ? `Uploading… ${Object.values(progress)[0]}%`
                : "Uploading…"}
            </span>
          )}
          <button
            type="button"
            data-testid="attach-drive-toggle"
            onClick={() => setDriveOpen((o) => !o)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            📁 Attach from Google Drive
          </button>
        </div>
        {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

        {driveOpen && (
          <form
            className="border-border bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (driveUrl.trim() && driveName.trim()) {
                attachDrive.mutate({
                  taskId,
                  url: driveUrl.trim(),
                  fileName: driveName.trim(),
                });
              }
            }}
          >
            <input
              value={driveUrl}
              placeholder="Drive share link (drive.google.com/file/d/…)"
              aria-label="Google Drive share link"
              data-testid="attach-drive-url"
              onChange={(e) => setDriveUrl(e.target.value)}
              className="border-border bg-background h-7 flex-1 min-w-40 rounded border px-2 text-xs"
            />
            <input
              value={driveName}
              placeholder="File name"
              aria-label="Google Drive file name"
              data-testid="attach-drive-name"
              onChange={(e) => setDriveName(e.target.value)}
              className="border-border bg-background h-7 w-32 rounded border px-2 text-xs"
            />
            <button
              type="submit"
              disabled={!driveUrl.trim() || !driveName.trim() || attachDrive.isPending}
              data-testid="attach-drive-submit"
              className="bg-primary text-primary-foreground h-7 shrink-0 rounded px-2 text-xs disabled:opacity-50"
            >
              Attach
            </button>
          </form>
        )}
        {driveError && <p className="text-xs text-red-500">{driveError}</p>}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </Section>
  );
}
