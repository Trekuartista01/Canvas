import type { AppRouter } from "@canvas/api";
import { HolidayCalendar } from "@/components/holiday-calendar";
import { LeaveForm } from "@/components/leave-form";
import { LeaveMonthCalendar } from "@/components/leave-month-calendar";
import { formatLeaveRange, LeaveStatusBadge } from "@/components/leave-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { formatDmy, LEAVE_TYPE_LABELS, todayReportDate } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ClipboardCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { workspaceShellRoute } from "./workspace.$workspaceId";

const TABS = [
  "pending",
  "approved",
  "rejected",
  "holidays",
  "calendar",
  "record",
  "balances",
] as const;
type Tab = (typeof TABS)[number];

// ?tab=… opens a tab (P8.2 Home banner → holidays); ?request=<id> (P8.4
// notification and email links) opens that request on its status tab.
const searchSchema = z.object({
  tab: z.enum(TABS).optional(),
  request: z.string().uuid().optional(),
});

export const leaveApprovalsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/leave-approvals",
  validateSearch: searchSchema,
  component: LeaveApprovalsPage,
});

type Outputs = inferRouterOutputs<AppRouter>["leave"];
type TeamRow = Outputs["team"][number];

const TAB_LABELS: Record<Tab, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  holidays: "Festat zyrtare / Official holidays",
  calendar: "Calendar",
  record: "Record leave",
  balances: "Balances",
};

// P8.4 Leave approvals — HR only (leave:approve), per docs/hr-ops-spec.md §3.
function LeaveApprovalsPage() {
  const { workspaceId } = leaveApprovalsRoute.useParams();
  const search = leaveApprovalsRoute.useSearch();
  const year = Number(todayReportDate(new Date()).slice(0, 4));
  const access = trpc.leave.mine.useQuery({ workspaceId, year });
  const canRecord = access.data?.canRecord ?? false;
  const holidays = trpc.holiday.list.useQuery({ workspaceId, year });
  const canManageHolidays = holidays.data?.canManage ?? false;
  const pending = trpc.leave.team.useQuery({ workspaceId, status: "pending" });
  const [tab, setTab] = useState<Tab>(search.tab ?? "pending");

  // A link to one request: open the tab its status lives on.
  const linked = trpc.leave.team.useQuery(
    { workspaceId, status: "all" },
    { enabled: Boolean(search.request) },
  );
  const linkedStatus = linked.data?.find((r) => r.id === search.request)?.status;
  useEffect(() => {
    if (linkedStatus === "approved" || linkedStatus === "rejected") setTab(linkedStatus);
  }, [linkedStatus]);

  const tabs = TABS.filter(
    (t) =>
      (t !== "holidays" || canManageHolidays) &&
      ((t !== "record" && t !== "balances") || canRecord),
  );
  const pendingCount = pending.data?.length ?? 0;

  return (
    <div
      className="mx-auto flex h-full max-w-4xl flex-col gap-4 p-6"
      data-testid="leave-approvals-page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <ClipboardCheck className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mr-auto text-lg font-semibold">Leave approvals</h1>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {tabs.map((t) => (
          <Button
            key={t}
            size="sm"
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? "default" : "ghost"}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
            {t === "pending" && pendingCount > 0 && (
              <span
                className="bg-accent text-accent-foreground ml-1 rounded-full px-1.5 text-[10px] font-semibold"
                data-testid="leave-pending-count"
              >
                {pendingCount}
              </span>
            )}
          </Button>
        ))}
      </div>
      {(tab === "pending" || tab === "approved" || tab === "rejected") && (
        <Requests key={tab} workspaceId={workspaceId} status={tab} highlight={search.request} />
      )}
      {tab === "holidays" && canManageHolidays && (
        <HolidayCalendar workspaceId={workspaceId} manage />
      )}
      {tab === "calendar" && (
        <LeaveMonthCalendar workspaceId={workspaceId} testId="approvals-calendar" />
      )}
      {tab === "record" && canRecord && <RecordLeave workspaceId={workspaceId} />}
      {tab === "balances" && canRecord && <Balances workspaceId={workspaceId} year={year} />}
    </div>
  );
}

function Requests({
  workspaceId,
  status,
  highlight,
}: {
  workspaceId: string;
  status: "pending" | "approved" | "rejected";
  highlight?: string;
}) {
  const team = trpc.leave.team.useQuery({ workspaceId, status });
  const rows = team.data ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 6,
  });
  const highlightIndex = highlight ? rows.findIndex((r) => r.id === highlight) : -1;
  useEffect(() => {
    if (highlightIndex >= 0) virtualizer.scrollToIndex(highlightIndex, { align: "start" });
  }, [highlightIndex, virtualizer]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2" aria-label="Leave requests">
      {team.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="leave-approvals-empty">
          {status === "pending" ? "Nothing waiting for a decision." : `No ${status} requests.`}
        </p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = rows[item.index]!;
              return (
                <div
                  key={r.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute right-0 left-0 pb-2"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <RequestCard request={r} highlighted={r.id === highlight} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function RequestCard({ request: r, highlighted }: { request: TeamRow; highlighted: boolean }) {
  const utils = trpc.useUtils();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const decide = trpc.leave.decide.useMutation({ onSuccess: () => utils.leave.invalidate() });

  return (
    <div
      className={`border-border space-y-2 rounded-md border px-3 py-2 text-sm ${
        highlighted ? "ring-accent ring-2" : ""
      }`}
      data-testid={`leave-approval-${r.userName}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{r.userName}</span>
        {r.own && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px]">
            Your request
          </span>
        )}
        <span>{LEAVE_TYPE_LABELS[r.type]}</span>
        <span>{formatLeaveRange(r.startDate, r.endDate)}</span>
        <span className="text-muted-foreground text-xs">
          {r.workingDays} working day{r.workingDays === 1 ? "" : "s"}
        </span>
        <LeaveStatusBadge status={r.status} />
        {r.selfApproved && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
            Self-approved
          </span>
        )}
        {r.documentAttachmentId && (
          <a
            href={`/uploads/${r.documentAttachmentId}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground ml-auto text-xs"
          >
            Document
          </a>
        )}
      </div>

      <dl className="text-muted-foreground grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        {r.excludedHolidays.length > 0 && (
          <div data-testid="leave-approval-holidays">
            <dt className="inline">Not counted: </dt>
            <dd className="inline">
              {r.excludedHolidays.map((h) => `${formatDmy(h.date)} ${h.name}`).join(", ")}
            </dd>
          </div>
        )}
        {r.balances.map((b) => (
          <div key={b.year} data-testid={`leave-approval-balance-${b.year}`}>
            <dt className="inline">Balance {b.year}: </dt>
            <dd className={`inline ${b.after < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
              {b.before} → {b.after} of {b.total} days
            </dd>
          </div>
        ))}
        {r.overlaps.length > 0 && (
          <div className="sm:col-span-2" data-testid="leave-approval-overlaps">
            <dt className="inline">Also off: </dt>
            <dd className="inline">
              {r.overlaps
                .map((o) => `${o.userName} (${formatDmy(o.startDate)}–${formatDmy(o.endDate)})`)
                .join(", ")}
            </dd>
          </div>
        )}
      </dl>

      {r.reason && <p className="text-muted-foreground text-xs">Note: “{r.reason}”</p>}
      {r.status === "rejected" && r.rejectionReason && (
        <p className="text-xs">
          <span className="text-muted-foreground">Reason given: </span>
          {r.rejectionReason}
        </p>
      )}
      {r.decidedByName && r.status !== "pending" && (
        <p className="text-muted-foreground text-xs">Decided by {r.decidedByName}</p>
      )}

      {r.status === "pending" && !r.canDecide && (
        <p className="text-muted-foreground text-xs">Another HR user has to decide this one.</p>
      )}
      {r.canDecide &&
        (rejecting ? (
          <form
            className="flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim())
                decide.mutate({ leaveRequestId: r.id, decision: "rejected", note: reason.trim() });
            }}
          >
            <Textarea
              autoFocus
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="A short reason (required)"
              aria-label="Reason for rejecting"
              className="min-w-60 flex-1"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!reason.trim() || decide.isPending}
              data-testid="leave-reject-confirm"
            >
              Reject
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ leaveRequestId: r.id, decision: "approved" })}
              data-testid="leave-approve"
            >
              {r.own ? "Approve (self-approval)" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejecting(true)}
              data-testid="leave-reject"
            >
              Reject
            </Button>
          </div>
        ))}
      {decide.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}

function RecordLeave({ workspaceId }: { workspaceId: string }) {
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const [userId, setUserId] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <section className="border-border space-y-3 rounded-md border p-4" aria-label="Record leave">
      <p className="text-muted-foreground text-xs">
        For leave someone couldn't request themselves (a sick day phoned in). It's approved straight
        away and the person is notified.
      </p>
      <select
        aria-label="Employee"
        value={userId}
        onChange={(e) => {
          setUserId(e.target.value);
          setSaved(false);
        }}
        className="border-border bg-background h-9 w-full max-w-sm rounded-md border px-2 text-sm"
      >
        <option value="">Choose a person…</option>
        {(members.data ?? []).map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </select>
      {userId && (
        <LeaveForm
          key={userId}
          workspaceId={workspaceId}
          forUserId={userId}
          onDone={() => setSaved(true)}
        />
      )}
      {saved && <p className="text-sm">Recorded.</p>}
    </section>
  );
}

function Balances({ workspaceId, year: initialYear }: { workspaceId: string; year: number }) {
  const utils = trpc.useUtils();
  const [year, setYear] = useState(initialYear);
  const balances = trpc.leave.balances.useQuery({ workspaceId, year });
  const setBalance = trpc.leave.setBalance.useMutation({
    onSuccess: () => utils.leave.invalidate(),
  });
  const setDefault = trpc.leave.setDefaultVacationDays.useMutation({
    onSuccess: () => utils.leave.invalidate(),
  });
  const rows = balances.data?.rows ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const parseDays = (value: string) => {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 366 ? n : undefined;
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Vacation balances">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Year
          <Input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => Number(e.target.value) && setYear(Number(e.target.value))}
            className="h-8 w-24"
          />
        </label>
        <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
          Default vacation days a year
          <Input
            type="number"
            min={0}
            max={366}
            aria-label="Default vacation days"
            key={balances.data?.defaultVacationDays}
            defaultValue={balances.data?.defaultVacationDays ?? 20}
            onBlur={(e) => {
              const days = parseDays(e.target.value);
              if (typeof days === "number" && days !== balances.data?.defaultVacationDays) {
                setDefault.mutate({ workspaceId, days });
              }
            }}
            className="h-8 w-20"
          />
        </label>
      </div>

      <div className="text-muted-foreground grid grid-cols-[1fr_6rem_6rem_4rem_4rem_5rem] gap-2 px-3 text-[11px] font-medium">
        <span>Person</span>
        <span>Entitlement</span>
        <span>Carried over</span>
        <span>Used</span>
        <span>Pending</span>
        <span>Remaining</span>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="leave-balances">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const r = rows[item.index]!;
            const save = (field: "entitlementDays" | "carriedOverDays", value: string) => {
              const days = parseDays(value);
              if (days === undefined) return;
              setBalance.mutate({ workspaceId, userId: r.userId, year, [field]: days });
            };
            return (
              <div
                key={`${r.userId}-${year}`}
                className="border-border absolute right-0 left-0 grid grid-cols-[1fr_6rem_6rem_4rem_4rem_5rem] items-center gap-2 border-b px-3 py-1.5 text-sm"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <span className="truncate font-medium">{r.name}</span>
                <Input
                  type="number"
                  aria-label={`Entitlement for ${r.name}`}
                  placeholder={String(balances.data?.defaultVacationDays ?? 20)}
                  defaultValue={r.entitlementOverride ?? ""}
                  onBlur={(e) =>
                    e.target.value !== String(r.entitlementOverride ?? "") &&
                    save("entitlementDays", e.target.value)
                  }
                  className="h-7 text-sm"
                />
                <Input
                  type="number"
                  aria-label={`Carried over for ${r.name}`}
                  placeholder="0"
                  defaultValue={r.carriedOverStored ?? ""}
                  onBlur={(e) =>
                    e.target.value !== String(r.carriedOverStored ?? "") &&
                    save("carriedOverDays", e.target.value)
                  }
                  className="h-7 text-sm"
                />
                <span>{r.balance.used}</span>
                <span>{r.balance.pending}</span>
                <span className="font-semibold">{r.balance.available}</span>
              </div>
            );
          })}
        </div>
      </div>
      {(setBalance.error ?? setDefault.error) && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {(setBalance.error ?? setDefault.error)?.message}
        </p>
      )}
    </section>
  );
}
