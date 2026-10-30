import { Field } from "@/components/detail-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

type Person = { userId: string; name: string };

/**
 * M7.2 "Transfer to colleague": replaces one assignee with another, with a
 * required note (posted as a comment so the new assignee has the context).
 * The server decides who may (the outgoing assignee, or an approver).
 */
export function TransferControl({
  taskId,
  assignees,
  members,
  onChanged,
}: {
  taskId: string;
  assignees: Person[];
  members: Person[];
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [note, setNote] = useState("");
  const transfer = trpc.task.transfer.useMutation({
    onSuccess: () => {
      setOpen(false);
      setNote("");
      setToUserId("");
      onChanged();
      void utils.comment.list.invalidate({ taskId });
      void utils.task.listMine.invalidate();
    },
  });

  if (assignees.length === 0) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setFromUserId(assignees[0]!.userId);
          setOpen(true);
        }}
        className="text-muted-foreground hover:text-foreground mt-1 text-xs"
        data-testid="transfer-task"
      >
        Transfer to colleague…
      </button>
    );
  }

  const candidates = members.filter((m) => !assignees.some((a) => a.userId === m.userId));
  return (
    <form
      className="border-border mt-2 space-y-2 rounded-md border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (fromUserId && toUserId && note.trim()) {
          transfer.mutate({ taskId, fromUserId, toUserId, note: note.trim() });
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          aria-label="Transfer from"
          value={fromUserId}
          onChange={(e) => setFromUserId(e.target.value)}
          className="border-border bg-background h-7 rounded border"
        >
          {assignees.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
            </option>
          ))}
        </select>
        <span>→</span>
        <select
          aria-label="Transfer to"
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          className="border-border bg-background h-7 rounded border"
        >
          <option value="">Choose colleague…</option>
          {candidates.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        required
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why, and anything they need to know (required)"
        aria-label="Transfer note"
      />
      {transfer.error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {transfer.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!toUserId || !note.trim() || transfer.isPending}
          data-testid="transfer-confirm"
        >
          Transfer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** M7.2: people kept in the loop on a task without being assigned it. */
export function CollaboratorsField({ taskId, members }: { taskId: string; members: Person[] }) {
  const utils = trpc.useUtils();
  const collaborators = trpc.task.collaborators.list.useQuery({ taskId });
  const refresh = () => utils.task.collaborators.list.invalidate({ taskId });
  const add = trpc.task.collaborators.add.useMutation({ onSuccess: refresh });
  const remove = trpc.task.collaborators.remove.useMutation({ onSuccess: refresh });
  const current = collaborators.data ?? [];

  return (
    <Field label="Collaborators">
      <div className="flex flex-wrap items-center gap-2" data-testid="task-collaborators">
        {current.map((c) => (
          <span
            key={c.userId}
            className="border-border flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs"
          >
            {c.name}
            <button
              type="button"
              aria-label={`Remove collaborator ${c.name}`}
              onClick={() => remove.mutate({ taskId, userId: c.userId })}
              className="text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </span>
        ))}
        <select
          value=""
          aria-label="Add collaborator"
          onChange={(e) => {
            if (e.target.value) add.mutate({ taskId, userId: e.target.value });
          }}
          className="border-border bg-background h-7 rounded border text-xs"
        >
          <option value="">+ Collaborator…</option>
          {members
            .filter((m) => !current.some((c) => c.userId === m.userId))
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
        </select>
      </div>
    </Field>
  );
}
