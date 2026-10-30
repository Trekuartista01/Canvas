import { trpc } from "@/lib/trpc";
import { todayReportDate } from "@canvas/shared";
import { Trophy } from "lucide-react";

function monthName(month: string) {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * M7.8: last month's Employee of the Month, for everyone all month. People
 * who see the whole workspace's performance also get the full ranking on
 * days 1–5 of the following month (the window is a display rule; the
 * ranking itself is only sent to them).
 */
export function EmployeeOfMonthBanner({ workspaceId }: { workspaceId: string }) {
  const result = trpc.performance.employeeOfMonth.useQuery({ workspaceId });
  const data = result.data;
  if (!data) return null;
  const today = todayReportDate(new Date());
  const showRanking =
    data.ranking !== null && today >= data.rankingVisibleFrom && today <= data.rankingVisibleUntil;

  return (
    <div className="space-y-3">
      {data.winner && (
        <div
          className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3"
          data-testid="eom-banner"
        >
          <Trophy className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300">
              Employee of the Month · {monthName(data.month)}
            </p>
            <p className="text-sm">
              <span className="font-semibold">{data.winner.name}</span>
              <span className="text-muted-foreground">
                {" "}
                — {data.winner.completedOnTime} on time, {data.winner.completedLate} late
              </span>
            </p>
          </div>
        </div>
      )}
      {showRanking && data.ranking && (
        <section
          className="border-border space-y-2 rounded-md border p-3"
          aria-label="Employee of the Month ranking"
          data-testid="eom-ranking"
        >
          <p className="text-sm font-semibold">
            {monthName(data.month)} ranking
            <span className="text-muted-foreground font-normal">
              {" "}
              · score = 2×on time + late − 2×overdue, at least 3 completed to qualify
            </span>
          </p>
          {data.ranking.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody had tasks last month.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {data.ranking.slice(0, 10).map((r, i) => (
                <li key={r.userId} className="flex gap-3">
                  <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  <span className="tabular-nums">{r.score}</span>
                  <span className="text-muted-foreground w-44 text-xs">
                    {r.completedOnTime} on time · {r.completedLate} late · {r.overdue} overdue
                  </span>
                  {!r.qualified && (
                    <span className="text-muted-foreground text-xs">not qualified</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
