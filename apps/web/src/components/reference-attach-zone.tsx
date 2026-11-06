import { Paperclip, X } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

export type AiReference = {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  imageAssetId: string | null;
  imageVersionId: string | null;
};

type UploadResult = AiReference;

async function uploadAiReference(workspaceId: string, file: File): Promise<UploadResult> {
  const body = new FormData();
  body.append("workspaceId", workspaceId);
  body.append("file", file);
  const res = await fetch("/ai-references/upload", {
    method: "POST",
    body,
    credentials: "include",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadResult;
}

const ACCEPT =
  "image/*,video/*,.pdf,.doc,.docx,.txt,.csv,.json,.md,application/pdf,text/plain,text/csv";

export function ReferenceAttachZone({
  workspaceId,
  references,
  onChange,
  disabled,
  children,
  testId = "reference-attach-zone",
}: {
  workspaceId: string;
  references: AiReference[];
  onChange: (next: AiReference[]) => void;
  disabled?: boolean;
  /** Optional composer / prompt content rendered inside the dropzone. */
  children?: ReactNode;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    if (files.length === 0 || disabled || uploading) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded: AiReference[] = [];
      for (const file of files) {
        uploaded.push(await uploadAiReference(workspaceId, file));
      }
      onChange([...references, ...uploaded].slice(0, 8));
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
      data-testid={testId}
      className={`border-border rounded-md border transition-colors ${
        dragging ? "border-accent bg-accent-soft" : ""
      }`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}

      {dragging && (
        <p className="text-accent pointer-events-none py-2 text-center text-xs font-medium">
          Drop image, file, or video to use as reference
        </p>
      )}

      {references.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-2 pb-2" data-testid="reference-chips">
          {references.map((ref) => (
            <li
              key={ref.id}
              className="bg-muted flex items-center gap-1 rounded px-2 py-0.5 text-xs"
              data-testid={`reference-chip-${ref.id}`}
            >
              {ref.imageVersionId ? (
                <img
                  src={`/image-versions/${ref.imageVersionId}/thumb`}
                  alt=""
                  className="h-5 w-5 rounded object-cover"
                />
              ) : (
                <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
              )}
              <span className="max-w-[10rem] truncate">{ref.fileName}</span>
              <button
                type="button"
                aria-label={`Remove ${ref.fileName}`}
                title={`Remove ${ref.fileName}`}
                disabled={disabled || uploading}
                onClick={() => onChange(references.filter((r) => r.id !== ref.id))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 px-2 pb-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Attach reference file"
          className="hidden"
          data-testid="reference-file-input"
          disabled={disabled || uploading}
          onChange={(e) => void addFiles(Array.from(e.target.files ?? []))}
        />
        <button
          type="button"
          data-testid="reference-attach-button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {uploading ? "Uploading…" : "Attach reference"}
        </button>
        <span className="text-muted-foreground text-[11px]">or drag & drop</span>
      </div>

      {error && <p className="px-2 pb-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
