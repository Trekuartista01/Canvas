import { Section } from "@/components/detail-field";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

/**
 * P8.9 (spec §10): in the card detail, move the card to another board or list,
 * or archive it. Boards come from the tree, so only boards this person can see
 * are offered. Archiving is the task's existing soft delete.
 */
export function CardMoveField({
  workspaceId,
  taskId,
  listId,
  onArchived,
}: {
  workspaceId: string;
  taskId: string;
  listId: string;
  onArchived: () => void;
}) {
  const utils = trpc.useUtils();
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });
  const [boardId, setBoardId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const invalidate = () => {
    void utils.task.get.invalidate({ taskId });
    void utils.task.board.invalidate();
    void utils.task.list.invalidate();
  };
  const move = trpc.task.update.useMutation({ onSuccess: invalidate });
  const archive = trpc.task.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onArchived();
    },
  });

  const currentBoardId = tree.data?.lists.find((l) => l.id === listId)?.spaceId ?? "";
  const shownBoardId = boardId ?? currentBoardId;
  const lists = (tree.data?.lists ?? []).filter((l) => l.spaceId === shownBoardId);
  const error = move.error ?? archive.error;

  return (
    <Section label="Board and list">
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="card-move">
        <select
          aria-label="Board"
          value={shownBoardId}
          onChange={(e) => setBoardId(e.target.value)}
          className="border-border bg-background h-7 rounded border px-1"
        >
          {(tree.data?.spaces ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="List"
          value={lists.some((l) => l.id === listId) ? listId : ""}
          disabled={move.isPending}
          onChange={(e) => {
            if (e.target.value) move.mutate({ taskId, listId: e.target.value });
          }}
          className="border-border bg-background h-7 rounded border px-1"
        >
          {!lists.some((l) => l.id === listId) && <option value="">Choose a list…</option>}
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {confirming ? (
          <>
            <span>Archive this card?</span>
            <button
              type="button"
              className="font-medium text-red-600 dark:text-red-400"
              disabled={archive.isPending}
              onClick={() => archive.mutate({ taskId })}
            >
              Yes, archive
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-red-600"
            onClick={() => setConfirming(true)}
          >
            Archive card
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error.message}
        </p>
      )}
    </Section>
  );
}
