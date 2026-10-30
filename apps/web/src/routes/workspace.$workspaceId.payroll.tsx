import type { AppRouter } from "@canvas/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { useMyAccess } from "@/hooks/use-my-access";
import { trpc } from "@/lib/trpc";
import { formatEur, formatIban, isValidIban } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { Banknote } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const payrollRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/payroll",
  component: PayrollPage,
});

type Row = inferRouterOutputs<AppRouter>["payroll"]["list"][number];
const GRID = "grid grid-cols-[minmax(10rem,1.4fr)_7rem_minmax(8rem,1fr)_9rem_7rem_7rem] gap-3";

// M7.7 HR payroll (payroll:view). The table shows ID-card numbers and IBANs
// masked; the drawer reveals one person's record — each of those reads,
// every edit and every export is in the audit trail.
function PayrollPage() {
  const { workspaceId } = payrollRoute.useParams();
  const access = useMyAccess(workspaceId);
  const canManage = access.can("payroll:manage");
  const [tab, setTab] = useState<"table" | "audit">("table");
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6" data-testid="payroll-page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Banknote className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Payroll</h1>
          <p className="text-muted-foreground text-xs">
            Confidential. Every view, change and export is recorded.
          </p>
        </div>
        <Button
          size="sm"
          variant={tab === "table" ? "default" : "ghost"}
          onClick={() => setTab("table")}
        >
          Table
        </Button>
        <Button
          size="sm"
          variant={tab === "audit" ? "default" : "ghost"}
          onClick={() => setTab("audit")}
        >
          Audit trail
        </Button>
        <a
          href={`/payroll-export/${workspaceId}/payroll.xlsx`}
          className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs"
          data-testid="payroll-export-xlsx"
        >
          Export Excel
        </a>
        <a
          href={`/payroll-export/${workspaceId}/payroll.pdf`}
          className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs"
          data-testid="payroll-export-pdf"
        >
          Export PDF
        </a>
      </div>

      {tab === "table" ? (
        <PayrollTable workspaceId={workspaceId} onOpen={setOpenUserId} />
      ) : (
        <AuditTrail workspaceId={workspaceId} />
      )}

      {openUserId && (
        <PayrollDrawer
          workspaceId={workspaceId}
          userId={openUserId}
          canManage={canManage}
          onClose={() => setOpenUserId(null)}
        />
      )}
    </div>
  );
}

function PayrollTable({
  workspaceId,
  onOpen,
}: {
  workspaceId: string;
  onOpen: (userId: string) => void;
}) {
  // Fetched once per visit (each fetch is an audit row) — no refetch on focus.
  const list = trpc.payroll.list.useQuery({ workspaceId }, { refetchOnWindowFocus: false });
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [list.data, search]);
  const total = rows.reduce((sum, r) => sum + (r.netSalaryEur ?? 0), 0);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2" aria-label="Payroll table">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search people"
          aria-label="Search people"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-60 text-sm"
        />
        <span className="text-muted-foreground ml-auto text-xs" data-testid="payroll-total">
          {rows.length} people · total net {formatEur(total)}
        </span>
      </div>
      <div className={`${GRID} text-muted-foreground px-3 text-[11px] font-medium`}>
        <span>Employee</span>
        <span>Net salary</span>
        <span>Bank</span>
        <span>IBAN</span>
        <span>ID card</span>
        <span>Updated</span>
      </div>
      {list.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="payroll-table">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = rows[item.index]!;
              return (
                <button
                  key={r.userId}
                  type="button"
                  onClick={() => onOpen(r.userId)}
                  className={`${GRID} border-border hover:bg-muted absolute right-0 left-0 items-center border-b px-3 py-2 text-left text-sm`}
                  style={{ transform: `translateY(${item.start}px)` }}
                  data-testid={`payroll-row-${r.name}`}
                >
                  <span className="truncate">
                    <span className="font-medium">{r.name}</span>
                    {r.jobTitle && (
                      <span className="text-muted-foreground text-xs"> · {r.jobTitle}</span>
                    )}
                  </span>
                  <span className="tabular-nums">{formatEur(r.netSalaryEur)}</span>
                  <span className="truncate">{r.bankName ?? "—"}</span>
                  <span className="text-muted-foreground font-mono text-xs">{r.iban ?? "—"}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {r.idCardNumber ?? "—"}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "Not set"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function PayrollDrawer({
  workspaceId,
  userId,
  canManage,
  onClose,
}: {
  workspaceId: string;
  userId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const record = trpc.payroll.get.useQuery(
    { workspaceId, userId },
    { refetchOnWindowFocus: false, staleTime: Infinity },
  );
  const { containerRef, onKeyDown } = useModalA11y(onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Payroll record"
        tabIndex={-1}
        className="border-border bg-background relative h-full w-full max-w-md overflow-y-auto border-l p-6 shadow-xl outline-none"
        data-testid="payroll-drawer"
      >
        {!record.data ? (
          <p className="text-muted-foreground text-sm">{record.error?.message ?? "Loading…"}</p>
        ) : (
          <PayrollForm
            key={record.data.updatedAt ? String(record.data.updatedAt) : "new"}
            workspaceId={workspaceId}
            record={record.data}
            canManage={canManage}
            onSaved={onClose}
          />
        )}
      </div>
    </div>
  );
}

function PayrollForm({
  workspaceId,
  record,
  canManage,
  onSaved,
}: {
  workspaceId: string;
  record: Row;
  canManage: boolean;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const [netSalary, setNetSalary] = useState(record.netSalaryEur?.toFixed(2) ?? "");
  const [idCard, setIdCard] = useState(record.idCardNumber ?? "");
  const [bankName, setBankName] = useState(record.bankName ?? "");
  const [iban, setIban] = useState(record.iban ? formatIban(record.iban) : "");
  const [holder, setHolder] = useState(record.accountHolder ?? record.name);
  const save = trpc.payroll.upsert.useMutation({
    onSuccess: () => {
      void utils.payroll.list.invalidate();
      void utils.payroll.get.invalidate();
      onSaved();
    },
  });
  const ibanProblem =
    iban.trim() && !isValidIban(iban) ? "That IBAN isn't valid — check the digits" : null;
  const disabled = !canManage;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ibanProblem) return;
    const amount =
      netSalary.trim() === "" ? null : Math.round(Number(netSalary.replace(",", ".")) * 100) / 100;
    if (amount !== null && !Number.isFinite(amount)) return;
    save.mutate({
      workspaceId,
      userId: record.userId,
      netSalaryEur: amount,
      idCardNumber: idCard.trim() || null,
      bankName: bankName.trim() || null,
      iban: iban.trim() || null,
      accountHolder: holder.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="payroll-form">
      <div>
        <h2 className="text-base font-semibold">{record.name}</h2>
        <p className="text-muted-foreground text-xs">
          {record.email}
          {record.updatedByName && record.updatedAt
            ? ` · last changed by ${record.updatedByName}, ${new Date(record.updatedAt).toLocaleDateString()}`
            : ""}
        </p>
      </div>
      <Field id="payroll-salary" label="Net salary (EUR / month)">
        <Input
          id="payroll-salary"
          inputMode="decimal"
          disabled={disabled}
          value={netSalary}
          onChange={(e) => setNetSalary(e.target.value)}
        />
      </Field>
      <Field id="payroll-idcard" label="ID card number">
        <Input
          id="payroll-idcard"
          disabled={disabled}
          value={idCard}
          onChange={(e) => setIdCard(e.target.value)}
        />
      </Field>
      <Field id="payroll-bank" label="Bank">
        <Input
          id="payroll-bank"
          disabled={disabled}
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
        />
      </Field>
      <Field id="payroll-iban" label="IBAN">
        <Input
          id="payroll-iban"
          disabled={disabled}
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          className="font-mono"
          aria-invalid={!!ibanProblem}
        />
        {ibanProblem && <p className="text-xs text-red-600 dark:text-red-400">{ibanProblem}</p>}
      </Field>
      <Field id="payroll-holder" label="Account holder">
        <Input
          id="payroll-holder"
          disabled={disabled}
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
        />
      </Field>
      {canManage ? (
        <Button
          type="submit"
          size="sm"
          disabled={save.isPending || !!ibanProblem}
          data-testid="payroll-save"
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">You can view payroll but not change it.</p>
      )}
      {save.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  "payroll.list_viewed": "opened the payroll table",
  "payroll.viewed": "viewed the record of",
  "payroll.updated": "changed the record of",
  "payroll.exported": "exported payroll",
  "payroll.self_viewed": "viewed their own pay details",
};

function AuditTrail({ workspaceId }: { workspaceId: string }) {
  const audit = trpc.payroll.audit.useQuery({ workspaceId });
  const rows = audit.data ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 15,
  });
  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="payroll-audit">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const r = rows[item.index]!;
          return (
            <div
              key={r.id}
              className="border-border absolute right-0 left-0 flex gap-3 border-b px-2 py-1.5 text-sm"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <span className="text-muted-foreground w-36 shrink-0 text-xs tabular-nums">
                {new Date(r.createdAt).toLocaleString()}
              </span>
              <span className="truncate">
                <span className="font-medium">{r.actorName}</span> {AUDIT_LABELS[r.verb] ?? r.verb}
                {r.subjectName && r.verb !== "payroll.self_viewed" && (
                  <span className="font-medium"> {r.subjectName}</span>
                )}
                {r.fields && (
                  <span className="text-muted-foreground"> ({r.fields.join(", ")})</span>
                )}
                {r.format && (
                  <span className="text-muted-foreground"> as {r.format.toUpperCase()}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
