import { DailyReportBody } from "@/components/daily-report-body";
import { Button } from "@/components/ui/button";
import { formatReportDate, formatReportTime } from "@/lib/daily-report-format";
import { trpc } from "@/lib/trpc";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import type { Editor } from "@tiptap/react";
import { NotebookPen } from "lucide-react";
import { useRef, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const dailyReportRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/daily-report",
  component: DailyReportPage,
});

function DailyReportPage() {
  const { workspaceId } = dailyReportRoute.useParams();
  const today = trpc.dailyReport.today.useQuery({ workspaceId });

  return (
    <div
      className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-6"
      data-testid="daily-report-page"
    >
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <NotebookPen className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Daily report</h1>
          <p className="text-muted-foreground text-xs">
            What you did today, what's next, anything blocking you. Editable until midnight.
          </p>
        </div>
      </div>

      {today.isLoading || !today.data ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <TodayForm
          // Remount at midnight (new date) or once the first save creates the row.
          key={`${today.data.reportDate}-${today.data.report?.id ?? "new"}`}
          workspaceId={workspaceId}
          reportDate={today.data.reportDate}
          report={today.data.report}
        />
      )}

      <History workspaceId={workspaceId} todayDate={today.data?.reportDate} />
    </div>
  );
}

function TodayForm({
  workspaceId,
  reportDate,
  report,
}: {
  workspaceId: string;
  reportDate: string;
  report: {
    id: string;
    bodyJson?: unknown;
    submittedAt: string | Date;
    updatedAt: string | Date;
  } | null;
}) {
  const utils = trpc.useUtils();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState(false);
  const save = trpc.dailyReport.save.useMutation({
    onSuccess: () => {
      setSaved(true);
      void utils.dailyReport.invalidate();
    },
  });

  return (
    <section className="space-y-3" aria-label="Today's report">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Today · {formatReportDate(reportDate)}</h2>
        <span className="text-muted-foreground text-xs" data-testid="daily-report-status">
          {report
            ? `Submitted at ${formatReportTime(report.submittedAt)}${
                new Date(report.updatedAt).getTime() > new Date(report.submittedAt).getTime() + 1000
                  ? ` · edited ${formatReportTime(report.updatedAt)}`
                  : ""
              }`
            : "Not submitted yet"}
        </span>
        {report && (
          <Link
            to="/w/$workspaceId/daily-reports/$reportId"
            params={{ workspaceId, reportId: report.id }}
            className="text-muted-foreground hover:text-foreground ml-auto text-xs"
          >
            View · read receipts
          </Link>
        )}
      </div>
      <DailyReportBody content={report?.bodyJson ?? null} editable onEditor={setEditor} />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!editor || save.isPending}
          onClick={() => {
            if (!editor) return;
            setSaved(false);
            save.mutate({ workspaceId, bodyJson: editor.getJSON() });
          }}
          data-testid="daily-report-submit"
        >
          {save.isPending ? "Saving…" : report ? "Save changes" : "Submit report"}
        </Button>
        {saved && !save.isPending && <span className="text-muted-foreground text-xs">Saved.</span>}
        {save.error && (
          <span className="text-sm text-red-600 dark:text-red-400" role="alert">
            {save.error.message}
          </span>
        )}
      </div>
    </section>
  );
}

function History({ workspaceId, todayDate }: { workspaceId: string; todayDate?: string }) {
  const mine = trpc.dailyReport.mine.useQuery({ workspaceId });
  const past = (mine.data ?? []).filter((r) => r.reportDate !== todayDate);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: past.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 46,
    overscan: 10,
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2" aria-label="Past reports">
      <h2 className="text-sm font-semibold">Past reports</h2>
      {mine.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : past.length === 0 ? (
        <p className="text-muted-foreground text-sm">No past reports yet.</p>
      ) : (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          data-testid="daily-report-history"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const report = past[item.index]!;
              return (
                <div
                  key={report.id}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <Link
                    to="/w/$workspaceId/daily-reports/$reportId"
                    params={{ workspaceId, reportId: report.id }}
                    className="border-border hover:bg-muted flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="flex-1 font-medium">
                      {formatReportDate(report.reportDate)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {report.readCount > 0 ? `Read by ${report.readCount}` : "Unread"}
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
