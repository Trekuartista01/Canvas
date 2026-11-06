import { useCompleteHighlightTask } from "@/hooks/use-task-mutations";
import { useOpenTaskPanel } from "@/hooks/use-task-panel";
import type { AppRouter } from "@canvas/api";
import type { inferRouterOutputs } from "@trpc/server";
import { Check } from "lucide-react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type HighlightTask = RouterOutputs["task"]["highlights"]["priority"][number];

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-status-critical/15 text-status-critical",
  high: "bg-status-serious/15 text-status-serious",
  normal: "bg-muted text-muted-foreground",
  low: "bg-muted text-muted-foreground",
};

export function TaskHighlightRow({
  task,
  workspaceId,
  memberNamesById,
  onNavigate,
}: {
  task: HighlightTask;
  workspaceId: string;
  memberNamesById: Map<string, string>;
  /** Fires when the row is clicked, before the task opens — lets an overlay
   * (e.g. LoginSummaryPanel) close itself on click-through. */
  onNavigate?: () => void;
}) {
  const assigneeNames = task.assigneeIds.map((id) => memberNamesById.get(id) ?? "Someone");
  const complete = useCompleteHighlightTask(workspaceId);
  const openTask = useOpenTaskPanel();
  const open = () => {
    onNavigate?.();
    openTask(task.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      data-testid={`task-highlight-${task.id}`}
      aria-label={`Open ${task.title}`}
      className="border-border bg-card flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-sm transition-shadow hover:shadow-md"
    >
      <button
        type="button"
        aria-label={`Mark ${task.title} done`}
        title="Mark done"
        data-testid={`task-highlight-complete-${task.id}`}
        disabled={complete.isPending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          complete.mutate({ taskId: task.id });
        }}
        className="border-border hover:border-accent hover:bg-accent-soft flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-transparent transition-colors hover:text-accent"
      >
        <Check className="h-3 w-3" aria-hidden />
      </button>
      {task.priority && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${PRIORITY_TONE[task.priority] ?? PRIORITY_TONE.normal}`}
        >
          {task.priority}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
      {assigneeNames.length > 0 && (
        <span className="text-muted-foreground shrink-0 truncate text-xs">
          {assigneeNames.join(", ")}
        </span>
      )}
      <span className="text-muted-foreground shrink-0 truncate text-xs">
        {task.spaceName} / {task.listName}
      </span>
    </div>
  );
}
