import { Paperclip, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

export type PublicUploadedFile = {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
};

async function uploadPublicFile(publicToken: string, file: File): Promise<PublicUploadedFile> {
  const body = new FormData();
  body.append("publicToken", publicToken);
  body.append("file", file);
  const res = await fetch("/public-forms/uploads", { method: "POST", body });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as PublicUploadedFile;
}

// The external-submitter counterpart to ReferenceAttachZone — same
// drag-and-drop/chip UX, but posts to the public-token-gated upload route
// instead of the session-authenticated one, since whoever has this link
// was never asked to log in.
export function PublicTaskAttachZone({
  publicToken,
  files,
  onChange,
  disabled,
}: {
  publicToken: string;
  files: PublicUploadedFile[];
  onChange: (next: PublicUploadedFile[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(newFiles: File[]) {
    if (newFiles.length === 0 || disabled || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded: PublicUploadedFile[] = [];
      for (const file of newFiles) {
        uploaded.push(await uploadPublicFile(publicToken, file));
      }
      onChange([...files, ...uploaded].slice(0, 8));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files ?? []));
  }

  return (
    <div
      data-testid="public-task-attach-zone"
      className={`border-border rounded-md border transition-colors ${
        dragging ? "border-accent bg-accent-soft" : ""
      }`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <p className="text-accent pointer-events-none py-3 text-center text-xs font-medium">
          Drop files to attach
        </p>
      )}

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 p-2" data-testid="public-attach-chips">
          {files.map((f) => (
            <li
              key={f.id}
              className="bg-muted flex items-center gap-1 rounded px-2 py-0.5 text-xs"
              data-testid={`public-attach-chip-${f.id}`}
            >
              <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
              <span className="max-w-[10rem] truncate">{f.fileName}</span>
              <button
                type="button"
                aria-label={`Remove ${f.fileName}`}
                title={`Remove ${f.fileName}`}
                disabled={disabled || uploading}
                onClick={() => onChange(files.filter((x) => x.id !== f.id))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 p-2 pt-0">
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Attach a file"
          className="hidden"
          data-testid="public-attach-file-input"
          disabled={disabled || uploading}
          onChange={(e) => void addFiles(Array.from(e.target.files ?? []))}
        />
        <button
          type="button"
          data-testid="public-attach-button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {uploading ? "Uploading…" : "Attach files"}
        </button>
        <span className="text-muted-foreground text-[11px]">or drag & drop</span>
      </div>

      {error && <p className="px-2 pb-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
