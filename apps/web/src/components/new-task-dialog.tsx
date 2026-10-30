import { TASK_PRIORITIES, type TaskPriority } from "@canvas/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import { useState, type FormEvent } from "react";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * M7.2 create dialog: one task handed to several people at once, with
 * priority, due date + time (Kosovo time) and the proof-photo requirement.
 * The inline "+ Add task" on the board stays the quick, title-only path.
 */
export function NewTaskDialog({
  workspaceId,
  listId,
  onClose,
}: {
  workspaceId: string;
  listId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const { containerRef, onKeyDown } = useModalA11y(onClose);
  const [title, setTitle] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [requiresProof, setRequiresProof] = useState(false);

  const create = trpc.task.create.useMutation({
    onSuccess: async () => {
      await utils.task.list.invalidate({ listId });
      onClose();
    },
  });

  function toggleAssignee(userId: string) {
    setAssigneeIds((ids) =>
      ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({
      listId,
      title: title.trim(),
      assigneeIds,
      priority: priority || null,
      dueDate: dueDate || null,
      dueTime: dueDate && dueTime ? dueTime : null,
      requiresProof,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="New task"
        tabIndex={-1}
        className="border-border bg-background relative w-full max-w-lg rounded-lg border p-5 shadow-xl outline-none"
        data-testid="new-task-dialog"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <h2 className="text-base font-semibold">New task</h2>

          <div className="space-y-1">
            <Label htmlFor="new-task-title" className="text-xs">
              Title
            </Label>
            <Input
              id="new-task-title"
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <fieldset className="space-y-1">
            <legend className="text-xs font-medium">Assign to</legend>
            <div className="border-border max-h-40 overflow-y-auto rounded-md border p-2">
              {(members.data ?? []).map((m) => (
                <label key={m.userId} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(m.userId)}
                    onChange={() => toggleAssignee(m.userId)}
                    aria-label={`Assign ${m.name}`}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-task-priority" className="text-xs">
                Priority
              </Label>
              <select
                id="new-task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority | "")}
                className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
              >
                <option value="">None</option>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-task-due-date" className="text-xs">
                Due date
              </Label>
              <Input
                id="new-task-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-task-due-time" className="text-xs">
                Due time
              </Label>
              <Input
                id="new-task-due-time"
                type="time"
                value={dueTime}
                disabled={!dueDate}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresProof}
              onChange={(e) => setRequiresProof(e.target.checked)}
            />
            Requires a proof photo before it can be submitted for approval
          </label>

          {create.error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {create.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!title.trim() || create.isPending}
              data-testid="new-task-submit"
            >
              {create.isPending ? "Creating…" : "Create task"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
