import { NewTaskDialog } from "@/components/new-task-dialog";
import { Button } from "@/components/ui/button";
import { TaskBoard } from "@/components/task-board";
import { TaskCalendarView } from "@/components/task-calendar-view";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { TaskGanttView } from "@/components/task-gantt-view";
import { TaskListView } from "@/components/task-list-view";
import { TaskTableView } from "@/components/task-table-view";
import { trpc } from "@/lib/trpc";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { workspaceShellRoute } from "./workspace.$workspaceId";

// `openTask` lets a notification link straight to a task's detail panel
// (see NotificationsBell) without the list route needing to know anything
// about notifications itself.
const searchSchema = z.object({
  openTask: z.string().uuid().optional(),
});

export const listRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/l/$listId",
  validateSearch: searchSchema,
  component: ListPage,
});

function ListPage() {
  const { workspaceId, listId } = listRoute.useParams();
  const { openTask } = listRoute.useSearch();
  const navigate = useNavigate({ from: listRoute.fullPath });
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });
  const [view, setView] = useState<"list" | "board" | "calendar" | "table" | "gantt">("list");
  const [openTaskId, setOpenTaskId] = useState<string | null>(openTask ?? null);
  const [creatingTask, setCreatingTask] = useState(false);

  const utils = trpc.useUtils();
  const templates = trpc.taskTemplate.list.useQuery({ workspaceId });
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const instantiate = trpc.taskTemplate.instantiate.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate({ listId });
      setSelectedTemplateId("");
    },
  });

  // A notification click navigates here via client-side routing, which
  // doesn't remount this component when the user is already on this same
  // list (only the search param changes) — so the initial-state seed above
  // isn't enough on its own; this re-applies it whenever openTask changes.
  useEffect(() => {
    if (openTask) setOpenTaskId(openTask);
  }, [openTask]);

  const list = tree.data?.lists.find((l) => l.id === listId);
  const space = list ? tree.data?.spaces.find((s) => s.id === list.spaceId) : undefined;
  const folder = list?.folderId
    ? tree.data?.folders.find((f) => f.id === list.folderId)
    : undefined;

  if (tree.isLoading) {
    return <p className="text-muted-foreground p-8 text-sm">Loading…</p>;
  }

  if (!list) {
    return (
      <p className="text-muted-foreground p-8 text-sm">This list doesn't exist (or was deleted).</p>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between px-6 pt-6">
        <div>
          <p className="text-muted-foreground text-xs">
            {space?.name}
            {folder ? ` / ${folder.name}` : ""}
          </p>
          <h1 className="text-lg font-semibold"># {list.name}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Button size="sm" onClick={() => setCreatingTask(true)} data-testid="new-task-button">
            + New task
          </Button>
          {(templates.data ?? []).length > 0 && (
            <select
              value={selectedTemplateId}
              aria-label="New from template"
              disabled={instantiate.isPending}
              onChange={(e) => {
                const templateId = e.target.value;
                setSelectedTemplateId(templateId);
                if (templateId) instantiate.mutate({ templateId, listId });
              }}
              className="border-border bg-background h-7 rounded border text-xs"
            >
              <option value="">+ From template…</option>
              {(templates.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-1">
            {(
              [
                ["list", "List"],
                ["board", "Board"],
                ["calendar", "Calendar"],
                ["table", "Table"],
                ["gantt", "Gantt"],
              ] as const
            ).map(([id, label], i) => (
              <span key={id} className="contents">
                {i > 0 && <span className="text-muted-foreground">·</span>}
                <button
                  type="button"
                  onClick={() => setView(id)}
                  className={
                    view === id ? "font-medium" : "text-muted-foreground hover:text-foreground"
                  }
                >
                  {label}
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
      {view === "list" ? (
        <TaskListView listId={listId} onOpenTask={setOpenTaskId} />
      ) : view === "board" ? (
        <TaskBoard listId={listId} onOpenTask={setOpenTaskId} />
      ) : view === "calendar" ? (
        <TaskCalendarView listId={listId} onOpenTask={setOpenTaskId} />
      ) : view === "table" ? (
        <TaskTableView listId={listId} onOpenTask={setOpenTaskId} />
      ) : (
        <TaskGanttView listId={listId} onOpenTask={setOpenTaskId} />
      )}

      {creatingTask && (
        <NewTaskDialog
          workspaceId={workspaceId}
          listId={listId}
          onClose={() => setCreatingTask(false)}
        />
      )}
      {openTaskId && (
        <TaskDetailPanel
          taskId={openTaskId}
          workspaceId={workspaceId}
          onClose={() => {
            setOpenTaskId(null);
            // Clear `openTask` so a reload doesn't resurrect the panel via
            // the effect above — the search param is only meant as a
            // one-time deep link from a notification.
            if (openTask) void navigate({ search: { openTask: undefined } });
          }}
          onOpenTask={setOpenTaskId}
        />
      )}
    </div>
  );
}
