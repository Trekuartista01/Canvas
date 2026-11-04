import { openSignedDownload } from "@/hooks/use-private-upload";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import { isPreviewableImage } from "@canvas/shared";
import { useEffect, useState } from "react";

interface ViewerFile {
  id: string;
  fileName: string;
  mime: string;
}

/**
 * P8.6: full-screen preview of a contract's files. Each file opened asks for
 * its own 5-minute signed link, so every view is in the audit log. HEIC can't
 * be rendered by most browsers, so it offers the download instead.
 */
export function ContractFileViewer({
  files,
  index,
  onIndexChange,
  onClose,
}: {
  files: ViewerFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const file = files[index];
  const { containerRef, onKeyDown: onModalKeyDown } = useModalA11y(onClose);
  const { mutateAsync: fileUrl } = trpc.contract.fileUrl.useMutation();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileId = file?.id;
  const rendersInline = file
    ? isPreviewableImage(file.mime) || file.mime === "application/pdf"
    : false;

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!fileId || !rendersInline) return;
    let current = true;
    fileUrl({ fileId, disposition: "inline" })
      .then((r) => {
        if (current) setUrl(r.url);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err.message : "Couldn't open the file");
      });
    return () => {
      current = false;
    };
  }, [fileId, rendersInline, fileUrl]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (files.length < 2) return;
      if (e.key === "ArrowRight") onIndexChange((index + 1) % files.length);
      if (e.key === "ArrowLeft") onIndexChange((index - 1 + files.length) % files.length);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, files.length, onIndexChange]);

  if (!file) return null;

  async function download() {
    if (!fileId) return;
    try {
      const link = await fileUrl({ fileId, disposition: "download" });
      openSignedDownload(link.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't download the file");
    }
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={onModalKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={`Contract file: ${file.fileName}`}
      tabIndex={-1}
      data-testid="contract-file-viewer"
      className="fixed inset-0 z-[70] flex flex-col bg-black/85 text-white outline-none"
    >
      <div className="flex items-center gap-3 px-4 py-3 text-sm">
        <span className="mr-auto truncate">
          {file.fileName}
          {files.length > 1 && ` (${index + 1} of ${files.length})`}
        </span>
        {url && file.mime === "application/pdf" && (
          <a href={url} target="_blank" rel="noreferrer" className="underline hover:opacity-75">
            Open in a new tab
          </a>
        )}
        <button
          type="button"
          onClick={() => void download()}
          className="underline hover:opacity-75"
        >
          Download
        </button>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="text-xl hover:opacity-75"
        >
          ✕
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-4">
        {files.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous file"
              onClick={() => onIndexChange((index - 1 + files.length) % files.length)}
              className="absolute left-3 text-3xl hover:opacity-75"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next file"
              onClick={() => onIndexChange((index + 1) % files.length)}
              className="absolute right-3 text-3xl hover:opacity-75"
            >
              ›
            </button>
          </>
        )}
        {error ? (
          <p role="alert">{error}</p>
        ) : !rendersInline ? (
          <p className="text-center text-sm">
            This browser can't show HEIC photos. Download the file to see it.
          </p>
        ) : !url ? (
          <p className="text-sm">Loading…</p>
        ) : file.mime === "application/pdf" ? (
          <iframe src={url} title={file.fileName} className="h-full w-full rounded bg-white" />
        ) : (
          <img src={url} alt={file.fileName} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}
