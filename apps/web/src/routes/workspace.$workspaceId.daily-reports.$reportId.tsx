import { DailyReportBody } from "@/components/daily-report-body";
import { formatReportDate, formatReportTime } from "@/lib/daily-report-format";
import { trpc } from "@/lib/trpc";
import { createRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const dailyReportViewRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/daily-reports/$reportId",
  component: DailyReportViewPage,
});

function DailyReportViewPage() {
  const { workspaceId, reportId } = dailyReportViewRoute.useParams();
  const report = trpc.dailyReport.get.useQuery({ reportId });
  const markRead = trpc.dailyReport.markRead.useMutation();
  const isMine = report.data?.isMine;
  const mutateMarkRead = markRead.mutate;

  // Opening someone else's report is what records the read receipt.
  useEffect(() => {
    if (isMine === false) mutateMarkRead({ reportId });
  }, [isMine, reportId, mutateMarkRead]);

  if (report.error) {
    return <p className="text-muted-foreground p-6 text-sm">{report.error.message}</p>;
  }
  if (!report.data) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  const data = report.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6" data-testid="daily-report-view">
      <div>
        <Link
          to={data.isMine ? "/w/$workspaceId/daily-report" : "/w/$workspaceId/team-reports"}
          params={{ workspaceId }}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          ← {data.isMine ? "My daily reports" : "Team reports"}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">
          {data.isMine ? "Your report" : data.authorName} · {formatReportDate(data.reportDate)}
        </h1>
        <p className="text-muted-foreground text-xs">
          Submitted at {formatReportTime(data.submittedAt)}
          {data.editable && (
            <>
              {" · "}
              <Link
                to="/w/$workspaceId/daily-report"
                params={{ workspaceId }}
                className="hover:text-foreground underline"
              >
                edit (until midnight)
              </Link>
            </>
          )}
        </p>
      </div>

      <article className="border-border rounded-md border p-4">
        <DailyReportBody content={data.bodyJson} editable={false} />
      </article>

      <section aria-label="Read by" data-testid="daily-report-readers">
        <h2 className="text-sm font-semibold">Read by</h2>
        {data.readers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody has opened it yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {data.readers.map((r) => (
              <li key={r.userId} className="flex gap-2">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground text-xs leading-5">
                  {new Date(r.readAt).toLocaleDateString()} {formatReportTime(r.readAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
