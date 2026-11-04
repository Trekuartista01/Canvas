import { decode } from "blurhash";
import { useEffect, useRef, useState } from "react";

const BLURHASH_CANVAS_SIZE = 32;

// Blurhash placeholder -> thumb -> full-res on demand, per CLAUDE.md's UI
// convention. The canvas paints the decoded blurhash instantly (pure CPU,
// no network); it fades out once the real thumbnail image finishes
// loading. Lightbox click loads the full-res original — see Lightbox.
export function BlurhashThumb({
  attachment,
  src,
  onClick,
}: {
  attachment: { id: string; blurhash: string | null; fileName: string };
  /** A signed link, for files /uploads never serves (HR files). */
  src?: string;
  onClick?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!attachment.blurhash || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pixels = decode(attachment.blurhash, BLURHASH_CANVAS_SIZE, BLURHASH_CANVAS_SIZE);
    const imageData = ctx.createImageData(BLURHASH_CANVAS_SIZE, BLURHASH_CANVAS_SIZE);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
  }, [attachment.blurhash]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${attachment.fileName}`}
      title={`Open ${attachment.fileName}`}
      className="border-border relative block h-20 w-20 overflow-hidden rounded-md border"
    >
      {attachment.blurhash && (
        <canvas
          ref={canvasRef}
          width={BLURHASH_CANVAS_SIZE}
          height={BLURHASH_CANVAS_SIZE}
          className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${
            loaded ? "opacity-0" : "opacity-100"
          }`}
        />
      )}
      <img
        src={src ?? `/uploads/${attachment.id}/thumb`}
        alt={attachment.fileName}
        onLoad={() => setLoaded(true)}
        className="relative h-20 w-20 object-cover"
      />
    </button>
  );
}
