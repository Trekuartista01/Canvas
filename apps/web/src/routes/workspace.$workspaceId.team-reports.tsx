import { Input } from "@/components/ui/input";
import { formatReportDate, formatReportTime } from "@/lib/daily-report-format";
import { trpc } from "@/lib/trpc";
import { todayReportDate } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { useRef, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const teamReportsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/team-reports",
  component: TeamReportsPage,
});

// M7.3 manager view: for one date, who submitted a daily report and who didn't.
function TeamReportsPage() {
  const { workspaceId } = teamReportsRoute.useParams();
  const [reportDate, setReportDate] = useState(() => todayReportDate(new Date()));
  const team = trpc.dailyReport.team.useQuery({ workspaceId, reportDate });
  const rows = team.data ?? [];
  const submitted = rows.filter((r) => r.report).length;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 46,
    overscan: 10,
  });

  return (
    <div
      className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6"
      data-testid="team-reports-page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <ClipboardCheck className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Team reports</h1>
          <p className="text-muted-foreground text-xs">
            {formatReportDate(reportDate)}
            {team.data && ` · ${submitted} of ${rows.length} submitted`}
          </p>
        </div>
        <Input
          type="date"
          aria-label="Report date"
          value={reportDate}
          onChange={(e) => e.target.value && setReportDate(e.target.value)}
          className="h-8 w-40 text-sm"
        />
      </div>

      {team.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : team.error ? (
        <p className="text-muted-foreground text-sm">{team.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody on your team reports daily yet.</p>
      ) : (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          data-testid="team-reports-list"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              const content = (
                <>
                  <span className="flex-1 truncate font-medium">{row.name}</span>
                  {row.report ? (
                    <span className="text-xs text-green-700 dark:text-green-400">
                      Submitted {formatReportTime(row.report.submittedAt)}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      Not submitted
                    </span>
                  )}
                  {row.report && (
                    <span className="text-muted-foreground w-20 text-right text-xs">
                      {row.report.readCount > 0 ? `Read by ${row.report.readCount}` : "Unread"}
                    </span>
                  )}
                </>
              );
              const className =
                "border-border flex items-center gap-3 rounded-md border px-3 py-2 text-sm";
              return (
                <div
                  key={row.userId}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                  data-testid={`team-report-${row.name}`}
                >
                  {row.report ? (
                    <Link
                      to="/w/$workspaceId/daily-reports/$reportId"
                      params={{ workspaceId, reportId: row.report.id }}
                      className={`${className} hover:bg-muted`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className={`${className} opacity-80`}>{content}</div>
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
