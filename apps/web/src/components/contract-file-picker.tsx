import {
  CONTRACT_FILE_ACCEPT,
  checkContractFiles,
  contractFileMime,
  isPreviewableImage,
} from "@canvas/shared";
import { FileText, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

function PendingTile({
  file,
  onRemove,
  disabled,
}: {
  file: File;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const previewable = isPreviewableImage(contractFileMime(file.name, file.type) ?? "");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewable) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, previewable]);

  return (
    <li className="w-20 text-[12px]" data-testid={`contract-pending-${file.name}`}>
      <div className="border-border bg-muted relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border">
        {url ? (
          <img src={url} alt={`Preview of ${file.name}`} className="h-full w-full object-cover" />
        ) : (
          <FileText className="text-muted-foreground h-7 w-7" aria-hidden />
        )}
        {!disabled && (
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={onRemove}
            className="bg-background/90 absolute top-0.5 right-0.5 rounded-full p-0.5"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
      <p className="truncate" title={file.name}>
        {file.name}
      </p>
    </li>
  );
}

/**
 * P8.6: choose contract pages by drag-and-drop or click, and see them before
 * anything is uploaded. The caller owns the list and does the saving.
 */
export function ContractFilePicker({
  files,
  onChange,
  disabled,
  label = "Contract files",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function add(incoming: File[]) {
    if (disabled || incoming.length === 0) return;
    const { accepted, errors: refused } = checkContractFiles(files.length, incoming);
    setErrors(refused);
    if (accepted.length > 0) onChange([...files, ...accepted]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    add([...e.dataTransfer.files]);
  }

  return (
    <div className="space-y-2">
      <div
        data-testid="contract-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-1 rounded-md border border-dashed px-3 py-4 text-center text-xs ${
          dragging ? "border-accent bg-accent-soft" : "border-border"
        }`}
      >
        <UploadCloud className="text-muted-foreground h-5 w-5" aria-hidden />
        <span>
          Drop the pages here, or{" "}
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="text-accent font-medium underline"
          >
            choose files
          </button>
        </span>
        <span className="text-muted-foreground">JPG, PNG, HEIC or PDF, up to 20 MB each</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          aria-label={label}
          accept={CONTRACT_FILE_ACCEPT}
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul className="text-xs text-red-600 dark:text-red-400" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid="contract-pending-files">
          {files.map((file, i) => (
            <PendingTile
              key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
              file={file}
              disabled={disabled}
              onRemove={() => onChange(files.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Uploading 2 of 5 — 40%" with a bar; nothing when idle. */
export function ContractUploadProgress({
  label,
  percent,
}: {
  label: string | null;
  percent: number;
}) {
  if (!label) return null;
  return (
    <div className="min-w-40 flex-1 space-y-1 text-xs" data-testid="contract-upload-progress">
      <span>{label}</span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-muted h-1.5 overflow-hidden rounded-full"
      >
        <div className="bg-accent h-full" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
