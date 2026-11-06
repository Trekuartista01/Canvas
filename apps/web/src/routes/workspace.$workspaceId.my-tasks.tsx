import type { AppRouter } from "@canvas/api";
import { EmployeeOfMonthBanner } from "@/components/employee-of-month-banner";
import { HolidaysMissingBanner } from "@/components/holidays-missing-banner";
import { NotificationToasts } from "@/components/notification-toasts";
import { isOverdue, type StatusKind } from "@canvas/shared";
import { formatDue } from "@/lib/format";
import { useSession } from "@/hooks/use-session";
import { useOpenTaskPanel } from "@/hooks/use-task-panel";
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
// status *kind* — the normalized open/active/review/done/closed every status has.
const GROUPS: { kind: StatusKind; label: string }[] = [
  { kind: "active", label: "In progress" },
  { kind: "review", label: "Awaiting approval" },
  { kind: "open", label: "To do" },
  { kind: "done", label: "Done" },
  { kind: "closed", label: "Closed" },
];

type Row = { type: "header"; label: string; count: number } | { type: "task"; task: MyTask };

function MyTasksPage() {
  const { workspaceId } = myTasksRoute.useParams();
  const tasks = trpc.task.listMine.useQuery({ workspaceId });
  const { user } = useSession();
  const openTask = useOpenTaskPanel();

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
          <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
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

      <NotificationToasts workspaceId={workspaceId} />
      <HolidaysMissingBanner workspaceId={workspaceId} />
      <EmployeeOfMonthBanner workspaceId={workspaceId} />

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
                    <h2 className="flex items-center gap-2 px-1 pt-4 pb-1.5 text-base font-semibold">
                      {row.label}
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                        {row.count}
                      </span>
                    </h2>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openTask(row.task.id)}
                      className="border-border bg-card flex w-full items-center gap-3 rounded-lg border border-l-4 px-3 py-2.5 text-left text-sm shadow-sm transition-shadow hover:shadow-md"
                      style={{ borderLeftColor: row.task.statusColor }}
                      title={row.task.statusName}
                      data-testid={`my-task-${row.task.id}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{row.task.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {row.task.spaceName} / {row.task.listName} · {row.task.statusName}
                        </span>
                      </span>
                      <span
                        className={
                          isOverdue(
                            {
                              dueDate: row.task.dueDate,
                              dueTime: row.task.dueTime,
                              done:
                                row.task.statusKind === "done" || row.task.statusKind === "closed",
                            },
                            new Date(),
                          )
                            ? "bg-status-critical/10 text-status-critical shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                            : "text-muted-foreground shrink-0 text-xs"
                        }
                      >
                        {formatDue(row.task.dueDate, row.task.dueTime) ?? "No due date"}
                      </span>
                    </button>
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
