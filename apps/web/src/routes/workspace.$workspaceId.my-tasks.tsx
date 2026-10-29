import type { AppRouter } from "@canvas/api";
import type { StatusKind } from "@canvas/shared";
import { useSession } from "@/hooks/use-session";
import { trpc } from "@/lib/trpc";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { CheckSquare } from "lucide-react";
import { useMemo, useRef } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

type MyTask = inferRouterOutputs<AppRouter>["task"]["listMine"][number];

export const myTasksRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/my-tasks",
  component: MyTasksPage,
});

// Statuses are per list, so tasks from different lists are grouped by their
// status *kind* — the normalized open/active/done/closed every status has.
const GROUPS: { kind: StatusKind; label: string }[] = [
  { kind: "active", label: "In progress" },
  { kind: "open", label: "To do" },
  { kind: "done", label: "Done" },
  { kind: "closed", label: "Closed" },
];

type Row = { type: "header"; label: string; count: number } | { type: "task"; task: MyTask };

function formatDue(dueDate: string | null) {
  if (!dueDate) return "No due date";
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function MyTasksPage() {
  const { workspaceId } = myTasksRoute.useParams();
  const tasks = trpc.task.listMine.useQuery({ workspaceId });
  const { user } = useSession();

  // The server already sorts by due date; grouping keeps that order. One
  // flat row list (headers + tasks) so the whole page virtualizes as one.
  const rows = useMemo<Row[]>(() => {
    const all = tasks.data ?? [];
    return GROUPS.flatMap(({ kind, label }) => {
      const inGroup = all.filter((t) => t.statusKind === kind);
      if (inGroup.length === 0) return [];
      return [
        { type: "header" as const, label, count: inGroup.length },
        ...inGroup.map((task) => ({ type: "task" as const, task })),
      ];
    });
  }, [tasks.data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.type === "header" ? 36 : 58),
    overscan: 10,
  });

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6" data-testid="my-tasks-page">
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <CheckSquare className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">My Tasks</h1>
          <p className="text-muted-foreground text-xs">
            Everything assigned to you in this workspace, soonest due first.
          </p>
        </div>
        {user && (
          <Link
            to="/w/$workspaceId/people/$userId"
            params={{ workspaceId, userId: user.id }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            My profile
          </Link>
        )}
      </div>

      {tasks.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="my-tasks-empty">
          Nothing is assigned to you right now.
        </p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="my-tasks-list">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={row.type === "header" ? `h-${row.label}` : row.task.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.type === "header" ? (
                    <h2 className="text-muted-foreground px-1 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase">
                      {row.label} <span className="font-normal">· {row.count}</span>
                    </h2>
                  ) : (
                    <Link
                      to="/w/$workspaceId/l/$listId"
                      params={{ workspaceId, listId: row.task.listId }}
                      search={{ openTask: row.task.id }}
                      className="border-border hover:bg-muted flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                      data-testid={`my-task-${row.task.id}`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.task.statusColor }}
                        title={row.task.statusName}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{row.task.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {row.task.spaceName} / {row.task.listName} · {row.task.statusName}
                        </span>
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {formatDue(row.task.dueDate)}
                      </span>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
