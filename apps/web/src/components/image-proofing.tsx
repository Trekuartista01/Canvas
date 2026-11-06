import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type MouseEvent, useState } from "react";

// A pin's position is stored as a percentage of the image's rendered box, not
// pixels — resolution-independent, and it lines up the same way regardless
// of how large the image happens to render.
function clickToPercent(e: MouseEvent<HTMLImageElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
}

export function ImageProofing({
  versionId,
  taskId,
  onAskBrain,
}: {
  versionId: string;
  taskId?: string;
  onAskBrain?: () => void;
}) {
  const utils = trpc.useUtils();
  const annotations = trpc.imageAsset.annotation.list.useQuery({ versionId });
  const create = trpc.imageAsset.annotation.create.useMutation({
    onSuccess: () => {
      void utils.imageAsset.annotation.list.invalidate({ versionId });
      setPending(null);
      setDraft("");
    },
  });
  const removeComment = trpc.comment.delete.useMutation({
    onSuccess: () => void utils.imageAsset.annotation.list.invalidate({ versionId }),
  });

  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  const pins = annotations.data ?? [];

  function handleImageClick(e: MouseEvent<HTMLImageElement>) {
    if (!taskId) return;
    setPending(clickToPercent(e));
    setSelectedPinId(null);
  }

  function submitPin() {
    if (!pending || !taskId || !draft.trim()) return;
    create.mutate({
      versionId,
      taskId,
      x: pending.x,
      y: pending.y,
      bodyJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: draft.trim() }] }],
      },
    });
  }

  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="image-proofing">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Proofing{pins.length ? ` (${pins.length})` : ""}</p>
        {taskId && onAskBrain && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            data-testid="proofing-ask-brain"
            aria-label="Ask Brain to critique this image"
            title="Ask Brain to critique this image"
            onClick={onAskBrain}
          >
            Critique with Brain
          </Button>
        )}
      </div>

      <div className="relative inline-block max-w-full">
        <img
          src={`/image-versions/${versionId}`}
          alt="Version being proofed"
          data-testid="proofing-image"
          onClick={handleImageClick}
          className={`border-border bg-muted max-w-full rounded-md border ${taskId ? "cursor-crosshair" : ""}`}
        />
        {pins.map((pin) => (
          <button
            key={pin.id}
            type="button"
            data-testid={`proofing-pin-${pin.id}`}
            aria-label="Pin comment"
            title="Pin comment"
            style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            onClick={() => setSelectedPinId(selectedPinId === pin.id ? null : pin.id)}
            className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${
              selectedPinId === pin.id ? "bg-primary" : "bg-red-500"
            }`}
          />
        ))}
        {pending && (
          <span
            style={{ left: `${pending.x}%`, top: `${pending.y}%` }}
            className="border-primary bg-primary/20 absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          />
        )}
      </div>

      {pending && (
        <div className="space-y-1">
          <textarea
            data-testid="proofing-pin-composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Comment on this spot…"
            className="border-border focus-visible:ring-primary w-full resize-none rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-6 px-2 text-xs"
              data-testid="proofing-pin-submit"
              disabled={!draft.trim() || create.isPending}
              onClick={submitPin}
            >
              Pin comment
            </Button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => {
                setPending(null);
                setDraft("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {pins.length > 0 && (
        <ul className="space-y-1">
          {pins.map((pin) => (
            <li
              key={pin.id}
              data-testid={`proofing-comment-${pin.id}`}
              className={`border-border rounded-md border px-2 py-1 text-xs ${
                selectedPinId === pin.id ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{pin.comment.authorName}</span>
                <span className="text-muted-foreground">
                  {formatRelativeTime(new Date(pin.createdAt))}
                </span>
              </div>
              <PinCommentBody bodyJson={pin.comment.bodyJson} />
              <button
                type="button"
                aria-label="Delete pin comment"
                title="Delete pin comment"
                onClick={() => removeComment.mutate({ commentId: pin.comment.id })}
                className="text-muted-foreground hover:text-foreground text-[12px]"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PinCommentBody({ bodyJson }: { bodyJson: unknown }) {
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit],
    content: (bodyJson as object | undefined) ?? "",
    editorProps: { attributes: { class: "prose prose-sm max-w-none" } },
  });
  return <EditorContent editor={editor} />;
}
