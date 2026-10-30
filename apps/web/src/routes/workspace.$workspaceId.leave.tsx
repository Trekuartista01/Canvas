import type { AppRouter } from "@canvas/api";
import type { inferRouterOutputs } from "@trpc/server";
import { LeaveForm } from "@/components/leave-form";
import { formatLeaveRange, LeaveStatusBadge } from "@/components/leave-status-badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { LEAVE_TYPE_LABELS, todayReportDate } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plane } from "lucide-react";
import { useRef, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const leaveRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/leave",
  component: LeavePage,
});

// M7.5 "My leave": vacation balance, the request form, and my requests.
function LeavePage() {
  const { workspaceId } = leaveRoute.useParams();
  const [year, setYear] = useState(() => Number(todayReportDate(new Date()).slice(0, 4)));
  const mine = trpc.leave.mine.useQuery({ workspaceId, year });
  const balance = mine.data?.balance;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-6" data-testid="leave-page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Plane className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">My leave</h1>
          <p className="text-muted-foreground text-xs">
            Working days only — weekends and public holidays don't count.
          </p>
        </div>
        {mine.data?.canApprove && (
          <Link
            to="/w/$workspaceId/leave-approvals"
            params={{ workspaceId }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Approvals →
          </Link>
        )}
      </div>

      <section aria-label="Vacation balance" className="space-y-2">
        <div className="flex items-center gap-1">
          <h2 className="mr-auto text-sm font-semibold">Vacation balance</h2>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous year"
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm font-semibold" data-testid="leave-year">
            {year}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next year"
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="leave-balance">
          <Stat label="Entitlement" value={balance?.entitlement} />
          <Stat label="Carried over" value={balance?.carriedOver} />
          <Stat label="Used" value={balance?.used} />
          <Stat label="Pending" value={balance?.pending} />
          <Stat label="Remaining" value={balance?.available} strong testId="leave-remaining" />
        </div>
      </section>

      <section aria-label="Request leave" className="border-border space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Request leave</h2>
        <LeaveForm workspaceId={workspaceId} />
      </section>

      <MyRequests requests={mine.data?.requests ?? []} />
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
  testId,
}: {
  label: string;
  value: number | undefined;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <div className="border-border rounded-md border p-2">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className={strong ? "text-lg font-semibold" : "text-lg"} data-testid={testId}>
        {value ?? "–"}
      </p>
    </div>
  );
}

type MyRequest = inferRouterOutputs<AppRouter>["leave"]["mine"]["requests"][number];

function MyRequests({ requests }: { requests: MyRequest[] }) {
  const utils = trpc.useUtils();
  const cancel = trpc.leave.cancel.useMutation({ onSuccess: () => utils.leave.invalidate() });
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: requests.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  return (
    <section aria-label="My requests" className="flex min-h-64 flex-1 flex-col gap-2">
      <h2 className="text-sm font-semibold">My requests</h2>
      {requests.length === 0 ? (
        <p className="text-muted-foreground text-sm">No leave requested yet.</p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="leave-requests">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = requests[item.index]!;
              return (
                <div
                  key={r.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div
                    className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
                    data-testid={`leave-request-${r.startDate}`}
                  >
                    <span className="font-medium">{LEAVE_TYPE_LABELS[r.type]}</span>
                    <span>{formatLeaveRange(r.startDate, r.endDate)}</span>
                    <span className="text-muted-foreground text-xs">
                      {r.workingDays} day{r.workingDays === 1 ? "" : "s"}
                    </span>
                    <LeaveStatusBadge status={r.status} />
                    <span className="ml-auto flex gap-3 text-xs">
                      {r.documentAttachmentId && (
                        <a
                          href={`/uploads/${r.documentAttachmentId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          Document
                        </a>
                      )}
                      {r.status === "approved" && (
                        <a
                          href={`/leave-documents/${r.id}/confirmation.pdf`}
                          className="text-muted-foreground hover:text-foreground"
                          data-testid="leave-pdf"
                        >
                          Download PDF
                        </a>
                      )}
                      {r.status === "pending" && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-red-600"
                          onClick={() => cancel.mutate({ leaveRequestId: r.id })}
                        >
                          Cancel
                        </button>
                      )}
                    </span>
                    {(r.decisionNote || r.decidedByName) && r.status !== "pending" && (
                      <span className="text-muted-foreground basis-full text-xs">
                        {r.recordedByName
                          ? `Recorded by ${r.recordedByName}`
                          : r.decidedByName
                            ? `${r.status === "approved" ? "Approved" : "Decided"} by ${r.decidedByName}`
                            : ""}
                        {r.decisionNote ? ` — “${r.decisionNote}”` : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {cancel.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {cancel.error.message}
        </p>
      )}
    </section>
  );
}
