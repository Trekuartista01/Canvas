import type { AppRouter } from "@canvas/api";
import { BarChart, DonutChart } from "@/components/charts";
import { formatShortDate } from "@/components/chart-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDue } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { addDays, todayReportDate } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { TrendingUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const performanceRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/performance",
  component: PerformancePage,
});

type TeamRow = inferRouterOutputs<AppRouter>["performance"]["team"][number];
const GRID = "grid grid-cols-[minmax(10rem,1.6fr)_repeat(6,4.5rem)] gap-2";
const ON_TIME_COLOR = { light: "#1baf7a", dark: "#199e70" };

function thisMonth(today: string) {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function lastMonth(today: string) {
  const to = addDays(`${today.slice(0, 7)}-01`, -1);
  return { from: `${to.slice(0, 7)}-01`, to };
}

// M7.8 (performance:view; a staff manager sees their own reports only).
function PerformancePage() {
  const { workspaceId } = performanceRoute.useParams();
  const today = todayReportDate(new Date());
  const [range, setRange] = useState(() => thisMonth(today));
  const [selected, setSelected] = useState<string | null>(null);
  const team = trpc.performance.team.useQuery({ workspaceId, ...range });
  const rows = team.data ?? [];
  const selectedRow = rows.find((r) => r.userId === selected) ?? null;

  return (
    <div
      className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6"
      data-testid="performance-page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <TrendingUp className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Performance</h1>
          <p className="text-muted-foreground text-xs">
            On time = finished by the due date and time (Kosovo time). Overdue = still open past it.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setRange(thisMonth(today))}>
          This month
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRange(lastMonth(today))}>
          Last month
        </Button>
        <Input
          type="date"
          aria-label="From"
          value={range.from}
          max={range.to}
          onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
          className="h-8 w-36 text-sm"
        />
        <Input
          type="date"
          aria-label="To"
          value={range.to}
          min={range.from}
          onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
          className="h-8 w-36 text-sm"
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_22rem]">
        <TeamTable
          rows={rows}
          loading={team.isLoading}
          selected={selected}
          onSelect={setSelected}
        />
        {selectedRow ? (
          <EmployeeDetail workspaceId={workspaceId} row={selectedRow} range={range} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Pick someone to see their charts and overdue tasks.
          </p>
        )}
      </div>
    </div>
  );
}

function TeamTable({
  rows,
  loading,
  selected,
  onSelect,
}: {
  rows: TeamRow[];
  loading: boolean;
  selected: string | null;
  onSelect: (userId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });
  return (
    <section className="flex min-h-0 flex-col gap-1" aria-label="Team performance">
      <div className={`${GRID} text-muted-foreground px-3 text-[11px] font-medium`}>
        <span>Employee</span>
        <span>Total</span>
        <span>On time</span>
        <span>Late</span>
        <span>Overdue</span>
        <span>In progress</span>
        <span>Not started</span>
      </div>
      {loading ? (
        <p className="text-muted-foreground px-3 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground px-3 text-sm">Nobody in your team yet.</p>
      ) : (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          data-testid="performance-table"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = rows[item.index]!;
              return (
                <button
                  key={r.userId}
                  type="button"
                  onClick={() => onSelect(r.userId)}
                  className={`${GRID} border-border hover:bg-muted absolute right-0 left-0 items-center border-b px-3 py-2 text-left text-sm tabular-nums ${
                    selected === r.userId ? "bg-muted" : ""
                  }`}
                  style={{ transform: `translateY(${item.start}px)` }}
                  data-testid={`performance-row-${r.name}`}
                >
                  <span className="truncate font-medium">{r.name}</span>
                  <span>{r.total}</span>
                  <span className="text-green-700 dark:text-green-400">{r.completedOnTime}</span>
                  <span className="text-amber-700 dark:text-amber-400">{r.completedLate}</span>
                  <span className={r.overdue > 0 ? "text-red-600 dark:text-red-400" : ""}>
                    {r.overdue}
                  </span>
                  <span>{r.inProgress}</span>
                  <span>{r.notStarted}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function EmployeeDetail({
  workspaceId,
  row,
  range,
}: {
  workspaceId: string;
  row: TeamRow;
  range: { from: string; to: string };
}) {
  const detail = trpc.performance.employee.useQuery({ workspaceId, userId: row.userId, ...range });
  const donut = useMemo(
    () => [
      { label: "On time", value: row.completedOnTime },
      { label: "Late", value: row.completedLate },
      { label: "Overdue", value: row.overdue },
      { label: "In progress", value: row.inProgress + row.notStarted },
    ],
    [row],
  );

  return (
    <aside
      className="border-border min-h-0 space-y-4 overflow-auto rounded-md border p-4"
      data-testid="performance-detail"
    >
      <h2 className="text-sm font-semibold">{row.name}</h2>
      <DonutChart data={donut} centerLabel="Tasks" centerValue={String(row.total)} />
      {detail.data && detail.data.weeks.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Finished on time, by week</p>
          <BarChart
            data={detail.data.weeks.map((w) => ({
              label: formatShortDate(w.start),
              value: w.onTime,
            }))}
            color={ON_TIME_COLOR}
            valueLabel={(v) => `${v} on time`}
          />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-semibold">Overdue tasks</p>
        {(detail.data?.overdueTasks ?? []).length === 0 ? (
          <p className="text-muted-foreground text-xs">None.</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="performance-overdue">
            {detail.data!.overdueTasks.map((t) => (
              <li key={t.id} className="flex gap-2">
                <Link
                  to="/w/$workspaceId/l/$listId"
                  params={{ workspaceId, listId: t.listId }}
                  search={{ openTask: t.id }}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {t.title}
                </Link>
                <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
                  {formatDue(t.dueDate, t.dueTime)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
