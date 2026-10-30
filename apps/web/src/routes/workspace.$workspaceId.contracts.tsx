import type { AppRouter } from "@canvas/api";
import { ExpiryBadge, orderContracts } from "@/components/contract-list-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openSignedDownload, useContractUpload } from "@/hooks/use-private-upload";
import { formatReportDate } from "@/lib/daily-report-format";
import { trpc } from "@/lib/trpc";
import { CONTRACT_KIND_LABELS, CONTRACT_KINDS, type ContractKind } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { FileSignature } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const contractsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/contracts",
  component: ContractsPage,
});

type Contract = inferRouterOutputs<AppRouter>["contract"]["list"][number];

// M7.6 HR view (contract:manage): every employee's contracts and annexes.
function ContractsPage() {
  const { workspaceId } = contractsRoute.useParams();
  const list = trpc.contract.list.useQuery({ workspaceId });
  const [search, setSearch] = useState("");
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (list.data ?? []).filter(
      (c) =>
        (!q || c.userName.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)) &&
        (!expiringOnly || (c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 30)),
    );
    return orderContracts<Contract>(filtered);
  }, [list.data, search, expiringOnly]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 8,
  });

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-6" data-testid="contracts-page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <FileSignature className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mr-auto text-lg font-semibold">Contracts</h1>
        <Input
          placeholder="Search person or title"
          aria-label="Search contracts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-56 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={expiringOnly}
            onChange={(e) => setExpiringOnly(e.target.checked)}
          />
          Expiring within 30 days
        </label>
        <Button size="sm" onClick={() => setAdding(!adding)} data-testid="contract-add">
          {adding ? "Close" : "File a document"}
        </Button>
      </div>

      {adding && (
        <AddContractForm
          workspaceId={workspaceId}
          contracts={list.data ?? []}
          onDone={() => setAdding(false)}
        />
      )}

      {list.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No contracts filed.</p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="contracts-list">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const { row, depth } = rows[item.index]!;
              return (
                <div
                  key={row.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)`, paddingLeft: depth * 24 }}
                >
                  <ContractRow workspaceId={workspaceId} contract={row} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ContractRow({ workspaceId, contract: c }: { workspaceId: string; contract: Contract }) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.contract.invalidate();
  const download = trpc.contract.downloadUrl.useMutation({
    onSuccess: (r) => openSignedDownload(r.url),
  });
  const update = trpc.contract.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.contract.delete.useMutation({ onSuccess: invalidate });
  const { upload, progress } = useContractUpload(workspaceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function replace(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const attachment = await upload(file);
      update.mutate({ contractId: c.id, attachmentId: attachment.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div
      className="border-border group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
      data-testid={`contract-row-${c.title}`}
    >
      <span className="w-36 truncate font-semibold">{c.userName}</span>
      <span className="bg-muted rounded-full px-2 py-0.5 text-[11px]">
        {CONTRACT_KIND_LABELS[c.kind]}
      </span>
      <span className="font-medium">{c.title}</span>
      <span className="text-muted-foreground text-xs">
        {formatReportDate(c.startDate)}
        {c.expiryDate && ` → ${formatReportDate(c.expiryDate)}`}
      </span>
      <ExpiryBadge daysLeft={c.daysLeft} />
      <span className="ml-auto flex items-center gap-2 text-xs">
        <label className="text-muted-foreground flex items-center gap-1">
          Ends
          <input
            type="date"
            aria-label={`Expiry date of ${c.title}`}
            defaultValue={c.expiryDate ?? ""}
            onBlur={(e) =>
              e.target.value !== (c.expiryDate ?? "") &&
              update.mutate({ contractId: c.id, expiryDate: e.target.value || null })
            }
            className="border-border bg-background h-7 rounded border px-1"
          />
        </label>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => download.mutate({ contractId: c.id })}
        >
          Download
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          aria-label={`Replace ${c.title}`}
          onChange={(e) => void replace(e.target.files?.[0])}
        />
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          disabled={progress !== null}
          onClick={() => fileRef.current?.click()}
        >
          {progress !== null ? `Uploading ${progress}%` : "Replace file"}
        </button>
        <button
          type="button"
          aria-label={`Delete ${c.title}`}
          className="text-muted-foreground hover:text-red-600"
          onClick={() => remove.mutate({ contractId: c.id })}
        >
          Delete
        </button>
      </span>
      {(error ?? update.error?.message ?? download.error?.message) && (
        <p className="basis-full text-xs text-red-600 dark:text-red-400" role="alert">
          {error ?? update.error?.message ?? download.error?.message}
        </p>
      )}
    </div>
  );
}

function AddContractForm({
  workspaceId,
  contracts,
  onDone,
}: {
  workspaceId: string;
  contracts: Contract[];
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<ContractKind>("contract");
  const [parentContractId, setParentContractId] = useState("");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { upload, progress } = useContractUpload(workspaceId);
  const create = trpc.contract.create.useMutation({
    onSuccess: () => {
      void utils.contract.invalidate();
      onDone();
    },
  });

  const parents = contracts.filter((c) => c.userId === userId && c.kind === "contract");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !title.trim() || !startDate || !file) return;
    setError(null);
    try {
      const attachment = await upload(file);
      create.mutate({
        workspaceId,
        userId,
        kind,
        parentContractId: kind === "contract" ? null : parentContractId || null,
        title: title.trim(),
        startDate,
        expiryDate: expiryDate || null,
        attachmentId: attachment.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="border-border grid grid-cols-2 gap-3 rounded-md border p-4 sm:grid-cols-3"
      data-testid="contract-form"
    >
      <div className="space-y-1">
        <Label htmlFor="contract-person" className="text-xs">
          Employee
        </Label>
        <select
          id="contract-person"
          required
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setParentContractId("");
          }}
          className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
        >
          <option value="">Choose…</option>
          {(members.data ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="contract-kind" className="text-xs">
          Kind
        </Label>
        <select
          id="contract-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ContractKind)}
          className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
        >
          {CONTRACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONTRACT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      {kind !== "contract" && (
        <div className="space-y-1">
          <Label htmlFor="contract-parent" className="text-xs">
            Belongs to
          </Label>
          <select
            id="contract-parent"
            required
            value={parentContractId}
            onChange={(e) => setParentContractId(e.target.value)}
            className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="">Choose a contract…</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="col-span-2 space-y-1 sm:col-span-3">
        <Label htmlFor="contract-title" className="text-xs">
          Title
        </Label>
        <Input
          id="contract-title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="contract-start" className="text-xs">
          Start date
        </Label>
        <Input
          id="contract-start"
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="contract-expiry" className="text-xs">
          Expiry date (optional)
        </Label>
        <Input
          id="contract-expiry"
          type="date"
          min={startDate || undefined}
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="contract-file" className="text-xs">
          File
        </Label>
        <input
          id="contract-file"
          type="file"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
      </div>
      <div className="col-span-2 flex items-center gap-3 sm:col-span-3">
        <Button
          type="submit"
          size="sm"
          disabled={progress !== null || create.isPending}
          data-testid="contract-save"
        >
          {progress !== null ? `Uploading ${progress}%` : "File it"}
        </Button>
        {(error ?? create.error?.message) && (
          <span className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error ?? create.error?.message}
          </span>
        )}
      </div>
    </form>
  );
}
