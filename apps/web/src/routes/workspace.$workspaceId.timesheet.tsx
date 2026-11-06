import {
  addDaysToDateOnly,
  formatDurationSec,
  groupTimeEntriesByDay,
  startOfWeekSunday,
  sumDurations,
  todayDateOnly,
} from "@canvas/shared";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { createRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Clock, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const timesheetRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/timesheet",
  component: TimesheetPage,
});

function TimesheetPage() {
  const { workspaceId } = timesheetRoute.useParams();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeekSunday(todayDateOnly()));
  const weekEnd = addDaysToDateOnly(weekStart, 6);

  const entries = trpc.timeEntry.timesheet.useQuery({
    workspaceId,
    start: weekStart,
    end: weekEnd,
  });
  const data = useMemo(() => entries.data ?? [], [entries.data]);
  const days = useMemo(() => groupTimeEntriesByDay(data), [data]);
  const totalSec = useMemo(() => sumDurations(data), [data]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
            <Clock className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Timesheet</h1>
            <p className="text-muted-foreground text-xs">Logged time by day, for this week.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            data-testid="timesheet-prev-week"
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
            data-testid="timesheet-next-week"
            aria-label="Next week"
            title="Next week"
            onClick={() => setWeekStart((w) => addDaysToDateOnly(w, 7))}
            className="border-border hover:bg-muted rounded border p-1.5"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <Card className="w-fit px-4 py-2 text-sm font-medium" data-testid="timesheet-total">
        Total: {formatDurationSec(totalSec)}
      </Card>

      {entries.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : days.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          No time logged this week.
        </Card>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.date} data-testid={`timesheet-day-${day.date}`} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{day.date}</p>
                <p
                  className="text-muted-foreground text-xs"
                  data-testid={`timesheet-day-total-${day.date}`}
                >
                  {formatDurationSec(day.totalSec)}
                </p>
              </div>
              <Card className="divide-y overflow-hidden p-0">
                {day.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setOpenTaskId(entry.taskId)}
                    data-testid={`timesheet-entry-${entry.id}`}
                    className="hover:bg-muted flex w-full items-center justify-between p-3 text-left text-sm transition-colors"
                  >
                    <span className="truncate underline-offset-2 hover:underline">
                      {entry.taskTitle}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {entry.durationSec != null
                        ? formatDurationSec(entry.durationSec)
                        : "running…"}
                    </span>
                  </button>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      <TeamOverviewSection workspaceId={workspaceId} start={weekStart} end={weekEnd} />

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

function formatUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

// Workspace-wide time + AI cost, per person — a Finance-Manager-style
// role's other main concern (see the `timeEntry:viewAll` custom-role
// grant on the Roles page). Both queries 403 for anyone without that
// grant; rather than showing an error, the section just doesn't render
// for the common case of a viewer who doesn't have it.
function TeamOverviewSection({
  workspaceId,
  start,
  end,
}: {
  workspaceId: string;
  start: string;
  end: string;
}) {
  const timesheet = trpc.timeEntry.workspaceTimesheet.useQuery({ workspaceId, start, end });
  const aiCost = trpc.aiUsage.workspaceCost.useQuery({ workspaceId, start, end });
  const members = trpc.workspace.members.useQuery({ workspaceId });

  const memberNamesById = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.userId, m.name])),
    [members.data],
  );

  const hoursByUser = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of timesheet.data ?? []) {
      totals.set(entry.userId, (totals.get(entry.userId) ?? 0) + (entry.durationSec ?? 0));
    }
    return totals;
  }, [timesheet.data]);

  if (timesheet.isError || aiCost.isError) return null;
  if (!timesheet.data || !aiCost.data) return null;

  const usdByUser = new Map(aiCost.data.byUser.map((r) => [r.userId, r.usd]));
  const userIds = [...new Set([...hoursByUser.keys(), ...usdByUser.keys()])];

  return (
    <Card data-testid="timesheet-team-overview">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-7 w-7 items-center justify-center rounded-md">
            <Wallet className="h-3.5 w-3.5" aria-hidden />
          </span>
          <CardTitle>Team overview</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Everyone's logged time and AI spend for this week —{" "}
          {formatDurationSec(sumDurations(timesheet.data))} total, {formatUsd(aiCost.data.totalUsd)}{" "}
          in AI cost.
        </p>
        {userIds.length === 0 ? (
          <p className="text-muted-foreground text-xs">Nothing logged by anyone this week.</p>
        ) : (
          <div className="divide-border divide-y rounded-md border">
            {userIds.map((userId) => (
              <div
                key={userId}
                className="flex items-center justify-between px-3 py-2 text-sm"
                data-testid={`team-overview-row-${userId}`}
              >
                <span className="truncate font-medium">
                  {memberNamesById.get(userId) ?? "Former member"}
                </span>
                <span className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
                  <span>{formatDurationSec(hoursByUser.get(userId) ?? 0)}</span>
                  <span>{formatUsd(usdByUser.get(userId) ?? 0)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
