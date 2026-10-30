import type { AppRouter } from "@canvas/api";
import { LeaveForm } from "@/components/leave-form";
import { formatLeaveRange, LeaveStatusBadge } from "@/components/leave-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { LEAVE_TYPE_LABELS, todayReportDate } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ClipboardCheck } from "lucide-react";
import { useRef, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const leaveApprovalsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/leave-approvals",
  component: LeaveApprovalsPage,
});

type Outputs = inferRouterOutputs<AppRouter>["leave"];
type Tab = "requests" | "record" | "balances";

// M7.5 approver view (leave:approve). HR (leave:recordForOthers) also gets
// "Record leave" and the balances table.
function LeaveApprovalsPage() {
  const { workspaceId } = leaveApprovalsRoute.useParams();
  const year = Number(todayReportDate(new Date()).slice(0, 4));
  const access = trpc.leave.mine.useQuery({ workspaceId, year });
  const canRecord = access.data?.canRecord ?? false;
  const [tab, setTab] = useState<Tab>("requests");

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
        <div className="flex gap-1" role="tablist">
          {(["requests", ...(canRecord ? (["record", "balances"] as const) : [])] as Tab[]).map(
            (t) => (
              <Button
                key={t}
                size="sm"
                role="tab"
                aria-selected={tab === t}
                variant={tab === t ? "default" : "ghost"}
                onClick={() => setTab(t)}
              >
                {t === "requests" ? "Requests" : t === "record" ? "Record leave" : "Balances"}
              </Button>
            ),
          )}
        </div>
      </div>
      {tab === "requests" && <Requests workspaceId={workspaceId} />}
      {tab === "record" && canRecord && <RecordLeave workspaceId={workspaceId} />}
      {tab === "balances" && canRecord && <Balances workspaceId={workspaceId} year={year} />}
    </div>
  );
}

function Requests({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const team = trpc.leave.team.useQuery({ workspaceId, status });
  const rows = team.data ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 6,
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2" aria-label="Leave requests">
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        Show
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "pending" | "all")}
          className="border-border bg-background h-8 rounded-md border px-2 text-sm"
        >
          <option value="pending">Waiting for a decision</option>
          <option value="all">All requests</option>
        </select>
      </label>
      {team.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="leave-approvals-empty">
          Nothing waiting for you.
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
                  <RequestRow request={r} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function RequestRow({ request: r }: { request: Outputs["team"][number] }) {
  const utils = trpc.useUtils();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const decide = trpc.leave.decide.useMutation({ onSuccess: () => utils.leave.invalidate() });

  return (
    <div
      className="border-border space-y-2 rounded-md border px-3 py-2 text-sm"
      data-testid={`leave-approval-${r.userName}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{r.userName}</span>
        <span>{LEAVE_TYPE_LABELS[r.type]}</span>
        <span>{formatLeaveRange(r.startDate, r.endDate)}</span>
        <span className="text-muted-foreground text-xs">
          {r.workingDays} day{r.workingDays === 1 ? "" : "s"}
        </span>
        <LeaveStatusBadge status={r.status} />
        {r.balance && (
          <span className="text-muted-foreground text-xs">
            {r.balance.remaining} of {r.balance.total} vacation days left in {r.balance.year}
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
      {r.reason && <p className="text-muted-foreground text-xs">“{r.reason}”</p>}
      {r.status === "pending" &&
        (rejecting ? (
          <form
            className="flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim())
                decide.mutate({ leaveRequestId: r.id, decision: "rejected", note: note.trim() });
            }}
          >
            <Textarea
              autoFocus
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why? (required)"
              aria-label="Reason for turning it down"
              className="min-w-60 flex-1"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!note.trim() || decide.isPending}
            >
              Turn down
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
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
              Turn down
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
