import { formatLeaveRange } from "@/components/leave-status-badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  LEAVE_TYPE_LABELS,
  WEEKDAY_LABELS,
  buildMonthGrid,
  isWeekend,
  monthLabel,
  todayReportDate,
} from "@canvas/shared";
import { createRoute } from "@tanstack/react-router";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const whosOffRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/whos-off",
  component: WhosOffPage,
});

// M7.5: approved leave on a month grid. Everyone sees who's away; the leave
// type only shows for people whose leave the viewer may see (server-side).
function WhosOffPage() {
  const { workspaceId } = whosOffRoute.useParams();
  const today = todayReportDate(new Date());
  const [month, setMonth] = useState(() => ({
    year: Number(today.slice(0, 4)),
    index: Number(today.slice(5, 7)) - 1,
  }));
  const cells = useMemo(() => buildMonthGrid(month.year, month.index), [month]);
  const from = cells[0]!.date;
  const to = cells[cells.length - 1]!.date;
  const calendar = trpc.leave.calendar.useQuery({ workspaceId, from, to });
  const leaves = calendar.data ?? [];

  const step = (delta: number) =>
    setMonth(({ year, index }) => {
      const next = index + delta;
      return { year: year + Math.floor(next / 12), index: ((next % 12) + 12) % 12 };
    });

  const inMonth = leaves.filter((l) => {
    const first = cells.find((c) => c.inMonth)!.date;
    const last = [...cells].reverse().find((c) => c.inMonth)!.date;
    return l.startDate <= last && l.endDate >= first;
  });

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-6" data-testid="whos-off-page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <CalendarRange className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mr-auto text-lg font-semibold">Who's off</h1>
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => step(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="w-36 text-center text-sm font-semibold" data-testid="whos-off-month">
          {monthLabel(month.year, month.index)}
        </span>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => step(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border text-xs">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="bg-muted text-muted-foreground px-2 py-1 font-medium">
            {d}
          </div>
        ))}
        {cells.map((cell) => {
          const off = isWeekend(cell.date)
            ? []
            : leaves.filter((l) => l.startDate <= cell.date && l.endDate >= cell.date);
          return (
            <div
              key={cell.date}
              className={`bg-background min-h-20 space-y-0.5 p-1 ${cell.inMonth ? "" : "opacity-40"} ${
                cell.date === today ? "ring-accent ring-1 ring-inset" : ""
              }`}
              data-testid={`whos-off-${cell.date}`}
            >
              <p className="text-muted-foreground text-[11px]">{cell.day}</p>
              {off.map((l) => (
                <p
                  key={l.id}
                  className="bg-accent-soft truncate rounded px-1 py-0.5"
                  title={l.type ? `${l.userName} — ${LEAVE_TYPE_LABELS[l.type]}` : l.userName}
                >
                  {l.userName}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      <section aria-label="Leave this month" className="space-y-1">
        <h2 className="text-sm font-semibold">This month</h2>
        {inMonth.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody is off.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {inMonth.map((l) => (
              <li key={l.id} className="flex gap-3">
                <span className="font-medium">{l.userName}</span>
                <span>{formatLeaveRange(l.startDate, l.endDate)}</span>
                {l.type && (
                  <span className="text-muted-foreground">{LEAVE_TYPE_LABELS[l.type]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
