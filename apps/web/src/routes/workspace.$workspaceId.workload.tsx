import {
  addDaysToDateOnly,
  startOfWeekSunday,
  suggestDiversify,
  tasksForUserOnDate,
  todayDateOnly,
  weeklyTaskCountForUser,
  WEEKDAY_LABELS,
} from "@canvas/shared";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { createRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const workloadRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/workload",
  component: WorkloadPage,
});

function WorkloadPage() {
  const { workspaceId } = workloadRoute.useParams();
  const [weekStart, setWeekStart] = useState(() => startOfWeekSunday(todayDateOnly()));
  const weekEnd = addDaysToDateOnly(weekStart, 6);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(weekStart, i)),
    [weekStart],
  );

  const members = trpc.workspace.members.useQuery({ workspaceId });
  const assignments = trpc.workload.assignments.useQuery({
    workspaceId,
    start: weekStart,
    end: weekEnd,
  });
  const data = useMemo(() => assignments.data ?? [], [assignments.data]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const openCounts = trpc.workload.openTaskCounts.useQuery({ workspaceId });
  const countByUserId = useMemo(
    () => new Map((openCounts.data ?? []).map((c) => [c.userId, c.count])),
    [openCounts.data],
  );
  const memberCounts = useMemo(
    () =>
      (members.data ?? []).map((m) => ({
        userId: m.userId,
        name: m.name,
        count: countByUserId.get(m.userId) ?? 0,
      })),
    [members.data, countByUserId],
  );
  const maxCount = Math.max(1, ...memberCounts.map((m) => m.count));
  const diversify = useMemo(
    () => suggestDiversify(memberCounts.map((m) => ({ userId: m.userId, count: m.count }))),
    [memberCounts],
  );
  const nameById = new Map(memberCounts.map((m) => [m.userId, m.name]));

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Workload</h1>
            <p className="text-muted-foreground text-xs">
              Who has what due this week, at a glance.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            data-testid="workload-prev-week"
            aria-label="Previous week"
            title="Previous week"
            onClick={() => setWeekStart((w) => addDaysToDateOnly(w, -7))}
            className="border-border hover:bg-muted rounded border p-1.5"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="text-muted-foreground text-xs">
            {weekStart} – {weekEnd}
          </span>
          <button
            type="button"
            data-testid="workload-next-week"
            aria-label="Next week"
            title="Next week"
            onClick={() => setWeekStart((w) => addDaysToDateOnly(w, 7))}
            className="border-border hover:bg-muted rounded border p-1.5"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {!members.isLoading && memberCounts.length > 0 && (
        <Card className="space-y-2 p-4" data-testid="workload-open-counts">
          <h2 className="text-base font-semibold">Current open tasks per person</h2>
          <div className="space-y-1.5">
            {memberCounts.map((m) => (
              <div
                key={m.userId}
                className="flex items-center gap-2 text-xs"
                data-testid={`workload-open-count-${m.userId}`}
              >
                <span className="w-28 shrink-0 truncate font-medium">{m.name}</span>
                <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-accent h-full rounded-full"
                    style={{ width: `${(m.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="text-muted-foreground w-6 shrink-0 text-right">{m.count}</span>
              </div>
            ))}
          </div>

          {diversify && (
            <div
              data-testid="workload-diversify-suggestion"
              className="border-status-warning/40 bg-status-warning/10 mt-2 flex items-start gap-2 rounded-md border p-2.5 text-xs"
            >
              <AlertTriangle
                className="text-status-warning mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              <p>
                <span className="font-medium">
                  {diversify.overloadedUserIds
                    .map((id) => nameById.get(id) ?? "Someone")
                    .join(", ")}
                </span>{" "}
                {diversify.overloadedUserIds.length === 1 ? "has" : "have"} {diversify.maxCount}{" "}
                open tasks, while{" "}
                <span className="font-medium">
                  {diversify.underloadedUserIds
                    .map((id) => nameById.get(id) ?? "someone")
                    .join(", ")}
                </span>{" "}
                {diversify.underloadedUserIds.length === 1 ? "has" : "have"} only{" "}
                {diversify.minCount}. Consider diversifying assignments to even out the load.
              </p>
            </div>
          )}
        </Card>
      )}

      {members.isLoading || assignments.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (members.data ?? []).length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">No members yet.</Card>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid gap-px overflow-hidden rounded-lg border bg-border text-xs shadow-sm"
            style={{ gridTemplateColumns: `160px repeat(7, minmax(120px, 1fr))` }}
          >
            <div className="bg-muted p-2 font-medium">Member</div>
            {days.map((date, i) => (
              <div key={date} className="bg-muted p-2 font-medium">
                {WEEKDAY_LABELS[i]} <span className="text-muted-foreground">{date.slice(5)}</span>
              </div>
            ))}

            {(members.data ?? []).map((member) => (
              <div
                key={member.userId}
                className="contents"
                data-testid={`workload-row-${member.userId}`}
              >
                <div className="bg-background flex items-center justify-between gap-2 p-2">
                  <span className="truncate font-medium">{member.name}</span>
                  <span
                    className="text-muted-foreground shrink-0"
                    data-testid={`workload-total-${member.userId}`}
                  >
                    {weeklyTaskCountForUser(data, member.userId)}
                  </span>
                </div>
                {days.map((date) => {
                  const tasks = tasksForUserOnDate(data, member.userId, date);
                  return (
                    <div
                      key={date}
                      data-testid={`workload-cell-${member.userId}-${date}`}
                      className="bg-background space-y-0.5 p-1"
                    >
                      {tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => setOpenTaskId(task.id)}
                          className="bg-muted hover:bg-muted/80 block w-full truncate rounded px-1 py-0.5 text-left"
                        >
                          {task.title}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {openTaskId && (
        <TaskDetailPanel
          taskId={openTaskId}
          workspaceId={workspaceId}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}
