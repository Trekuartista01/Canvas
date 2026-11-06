import type { AppRouter } from "@canvas/api";
import { BlurhashThumb } from "@/components/blurhash-thumb";
import { ContractFilePicker, ContractUploadProgress } from "@/components/contract-file-picker";
import { ContractFileViewer } from "@/components/contract-file-viewer";
import { orderContracts } from "@/components/contract-list-helpers";
import { RequireAccess } from "@/components/require-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openSignedDownload, useContractFilesUpload } from "@/hooks/use-private-upload";
import { trpc } from "@/lib/trpc";
import {
  CONTRACT_FILE_ACCEPT,
  CONTRACT_KIND_LABELS,
  CONTRACT_KINDS,
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPES,
  checkContractFiles,
  formatDmy,
  isContractEndingSoon,
  isPreviewableImage,
  personContractStatus,
  todayReportDate,
  type ContractStatus,
  type ContractKind,
  type ContractType,
} from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, FileSignature, FileText } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { workspaceShellRoute } from "./workspace.$workspaceId";

// ?person=<id> opens that person (the contract-ending notification and email).
const searchSchema = z.object({ person: z.string().uuid().optional() });

export const contractsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/contracts",
  validateSearch: searchSchema,
  component: GuardedContractsPage,
});

function GuardedContractsPage() {
  const { workspaceId } = contractsRoute.useParams();
  return (
    <RequireAccess workspaceId={workspaceId} action="contract:manage">
      <ContractsPage />
    </RequireAccess>
  );
}

type Outputs = inferRouterOutputs<AppRouter>["contract"];
type Contract = Outputs["forPerson"][number];
type ContractFile = Contract["files"][number];

interface Person {
  userId: string;
  name: string;
  archived: boolean;
  contracts: number;
  endingSoon: boolean;
  status: ContractStatus;
  endDate: string | null;
}

const STATUS_NAME_CLASS: Record<ContractStatus, string> = {
  none: "",
  valid: "text-green-700 dark:text-green-400",
  ending: "text-red-600 dark:text-red-400",
};

function EndingSoonBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      Ending soon
    </span>
  );
}

// P8.6 (spec §6), HR only: everyone in the workspace on the left, the chosen
// person's contracts and files on the right.
function ContractsPage() {
  const { workspaceId } = contractsRoute.useParams();
  const { person: selected } = contractsRoute.useSearch();
  const navigate = contractsRoute.useNavigate();
  const list = trpc.contract.list.useQuery({ workspaceId });
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const [search, setSearch] = useState("");
  const [endingOnly, setEndingOnly] = useState(false);

  const people = useMemo(() => {
    const today = todayReportDate(new Date());
    const byId = new Map<string, Person>();
    const documents = new Map<string, NonNullable<typeof list.data>>();
    for (const m of members.data ?? []) {
      byId.set(m.userId, {
        userId: m.userId,
        name: m.name,
        archived: false,
        contracts: 0,
        endingSoon: false,
        status: "none",
        endDate: null,
      });
    }
    // Someone with contracts who isn't an active member is archived: their
    // files stay reachable for the records.
    for (const c of list.data ?? []) {
      const person = byId.get(c.userId) ?? {
        userId: c.userId,
        name: c.userName,
        archived: true,
        contracts: 0,
        endingSoon: false,
        status: "none" as const,
        endDate: null,
      };
      person.contracts += 1;
      person.endingSoon ||= isContractEndingSoon(today, c.expiryDate);
      byId.set(c.userId, person);
      documents.set(c.userId, [...(documents.get(c.userId) ?? []), c]);
    }
    for (const [userId, docs] of documents) {
      const person = byId.get(userId)!;
      // Archived people get no alert, so no colour either.
      if (!person.archived) Object.assign(person, personContractStatus(today, docs));
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members.data, list.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter(
      (p) => (!q || p.name.toLowerCase().includes(q)) && (!endingOnly || p.endingSoon),
    );
  }, [people, search, endingOnly]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });

  const person = people.find((p) => p.userId === selected);
  const open = (userId?: string) =>
    void navigate({ search: userId ? { person: userId } : {}, replace: !userId });

  return (
    <div
      className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-4 sm:p-6"
      data-testid="contracts-page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <FileSignature className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mr-auto text-2xl font-bold tracking-tight">Contracts</h1>
        <Input
          placeholder="Search people"
          aria-label="Search people"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={endingOnly}
            onChange={(e) => setEndingOnly(e.target.checked)}
          />
          Ending soon only
        </label>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[17rem_1fr]">
        <div
          ref={parentRef}
          className={`min-h-0 overflow-auto ${selected ? "hidden md:block" : ""}`}
          data-testid="contracts-people"
        >
          {list.isLoading || members.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody matches.</p>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((item) => {
                const p = rows[item.index]!;
                return (
                  <div
                    key={p.userId}
                    className="absolute right-0 left-0 pb-1"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <button
                      type="button"
                      aria-current={p.userId === selected ? "true" : undefined}
                      data-testid={`contract-person-${p.name}`}
                      data-contract-status={p.status}
                      onClick={() => open(p.userId)}
                      className={`border-border hover:bg-muted flex h-12 w-full items-center gap-2 rounded-md border px-3 text-left text-sm ${
                        p.userId === selected ? "bg-muted" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate font-medium ${STATUS_NAME_CLASS[p.status]}`}
                        >
                          {p.name}
                        </span>
                        <span className="text-muted-foreground block text-[12px]">
                          {p.archived ? "Archived · " : ""}
                          {p.contracts === 0
                            ? "No contract filed"
                            : `${p.contracts} document${p.contracts === 1 ? "" : "s"}`}
                          {p.status === "ending" && p.endDate
                            ? ` · ends ${formatDmy(p.endDate)}`
                            : ""}
                        </span>
                      </span>
                      {p.endingSoon && <EndingSoonBadge />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`min-h-0 ${selected ? "" : "hidden md:block"}`}>
          {selected ? (
            <PersonContracts
              key={selected}
              workspaceId={workspaceId}
              userId={selected}
              name={person?.name ?? ""}
              archived={person?.archived ?? false}
              onBack={() => open()}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Choose a person to see their contracts.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonContracts({
  workspaceId,
  userId,
  name,
  archived,
  onBack,
}: {
  workspaceId: string;
  userId: string;
  name: string;
  archived: boolean;
  onBack: () => void;
}) {
  const contracts = trpc.contract.forPerson.useQuery({ workspaceId, userId });
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => orderContracts<Contract>(contracts.data ?? []), [contracts.data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 220,
    overscan: 4,
  });

  return (
    <div className="flex h-full flex-col gap-3" data-testid={`contract-detail-${name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Back to people"
          onClick={onBack}
          className="text-muted-foreground md:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="mr-auto font-semibold">{name}</h2>
        {!archived && (
          <Button size="sm" onClick={() => setAdding(!adding)} data-testid="contract-add">
            {adding ? "Close" : "Add a document"}
          </Button>
        )}
      </div>

      {adding && (
        <AddContractForm
          workspaceId={workspaceId}
          userId={userId}
          contracts={contracts.data ?? []}
          onDone={() => setAdding(false)}
        />
      )}

      {contracts.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : contracts.error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {contracts.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No contract filed yet.</p>
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
                  className="absolute right-0 left-0 pb-2"
                  style={{ transform: `translateY(${item.start}px)`, paddingLeft: depth * 24 }}
                >
                  <ContractCard workspaceId={workspaceId} userId={userId} contract={row} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Optimistic edit of one person's contracts, with rollback on error. */
function usePersonCacheUpdate(workspaceId: string, userId: string) {
  const utils = trpc.useUtils();
  const input = { workspaceId, userId };
  return <V,>(patch: (rows: Contract[], vars: V) => Contract[]) => ({
    onMutate: async (vars: V) => {
      await utils.contract.forPerson.cancel(input);
      const previous = utils.contract.forPerson.getData(input);
      utils.contract.forPerson.setData(input, (rows) => (rows ? patch(rows, vars) : rows));
      return { previous };
    },
    onError: (_err: unknown, _vars: V, context?: { previous?: Contract[] }) => {
      if (context?.previous) utils.contract.forPerson.setData(input, context.previous);
    },
    onSettled: () => utils.contract.invalidate(),
  });
}

function ContractCard({
  workspaceId,
  userId,
  contract: c,
}: {
  workspaceId: string;
  userId: string;
  contract: Contract;
}) {
  const utils = trpc.useUtils();
  const cache = usePersonCacheUpdate(workspaceId, userId);
  const today = todayReportDate(new Date());
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const remove = trpc.contract.delete.useMutation(
    cache<{ contractId: string }>((rows, v) => rows.filter((r) => r.id !== v.contractId)),
  );
  const ended = c.expiryDate !== null && c.expiryDate < today;

  return (
    <div
      className="bg-card shadow-sm border-border space-y-3 rounded-md border p-3 text-sm"
      data-testid={`contract-row-${c.title}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="bg-muted rounded-full px-2 py-0.5 text-[12px]">
          {CONTRACT_KIND_LABELS[c.kind]}
        </span>
        <span className="font-medium">{c.title}</span>
        {isContractEndingSoon(today, c.expiryDate) && <EndingSoonBadge />}
        {ended && <span className="text-muted-foreground text-xs">Ended</span>}
        <span className="ml-auto flex items-center gap-3 text-xs">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setAddingFiles(!addingFiles)}
          >
            {addingFiles ? "Close" : "Add pages"}
          </button>
          {confirmingDelete ? (
            <>
              <span>Delete this document and its files?</span>
              <button
                type="button"
                className="font-medium text-red-600 dark:text-red-400"
                onClick={() => remove.mutate({ contractId: c.id })}
              >
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={`Delete ${c.title}`}
              className="text-muted-foreground hover:text-red-600"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </button>
          )}
        </span>
      </div>

      <dl className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <div className="flex gap-1">
          <dt>Type:</dt>
          <dd className="text-foreground">
            {c.contractType ? CONTRACT_TYPE_LABELS[c.contractType] : "Not set"}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>Start:</dt>
          <dd className="text-foreground">{formatDmy(c.startDate)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>End:</dt>
          <dd className="text-foreground" data-testid="contract-end">
            {c.expiryDate ? formatDmy(c.expiryDate) : "No end date"}
          </dd>
        </div>
      </dl>

      {editing && (
        <EditContractForm
          workspaceId={workspaceId}
          userId={userId}
          contract={c}
          onDone={() => setEditing(false)}
        />
      )}

      <ul className="flex flex-wrap gap-3" data-testid="contract-files">
        {c.files.map((file, i) => (
          <FileTile
            key={file.id}
            workspaceId={workspaceId}
            userId={userId}
            file={file}
            canDelete={c.files.length > 1}
            onOpen={() => setViewing(i)}
          />
        ))}
      </ul>

      {addingFiles && (
        <AddFilesForm
          workspaceId={workspaceId}
          contractId={c.id}
          onDone={() => {
            setAddingFiles(false);
            void utils.contract.invalidate();
          }}
        />
      )}

      {remove.error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {remove.error.message}
        </p>
      )}
      {viewing !== null && (
        <ContractFileViewer
          files={c.files}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function FileTile({
  workspaceId,
  userId,
  file,
  canDelete,
  onOpen,
}: {
  workspaceId: string;
  userId: string;
  file: ContractFile;
  canDelete: boolean;
  onOpen: () => void;
}) {
  const utils = trpc.useUtils();
  const cache = usePersonCacheUpdate(workspaceId, userId);
  const { upload, label } = useContractFilesUpload(workspaceId);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const download = trpc.contract.fileUrl.useMutation({
    onSuccess: (r) => openSignedDownload(r.url),
  });
  const replace = trpc.contract.replaceFile.useMutation({
    onSuccess: () => utils.contract.invalidate(),
  });
  const remove = trpc.contract.deleteFile.useMutation(
    cache<{ fileId: string }>((rows, v) =>
      rows.map((r) => ({ ...r, files: r.files.filter((f) => f.id !== v.fileId) })),
    ),
  );

  async function onReplace(chosen: File | undefined) {
    if (!chosen) return;
    setError(null);
    const { accepted, errors } = checkContractFiles(0, [chosen]);
    const next = accepted[0];
    try {
      if (!next) throw new Error(errors[0] ?? "That file can't be used");
      const attachment = await upload(next);
      await replace.mutateAsync({ fileId: file.id, attachmentId: attachment.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  const message = error ?? download.error?.message ?? remove.error?.message;
  const uploaded = formatDmy(todayReportDate(new Date(file.createdAt)));

  return (
    <li className="w-44 space-y-1 text-[12px]" data-testid={`contract-file-${file.fileName}`}>
      {file.thumbUrl && isPreviewableImage(file.mime) ? (
        <BlurhashThumb
          attachment={{ id: file.id, blurhash: file.blurhash, fileName: file.fileName }}
          src={file.thumbUrl}
          onClick={onOpen}
        />
      ) : (
        <button
          type="button"
          aria-label={`Open ${file.fileName}`}
          title={`Open ${file.fileName}`}
          onClick={onOpen}
          className="border-border bg-muted flex h-20 w-20 items-center justify-center rounded-md border"
        >
          <FileText className="text-muted-foreground h-7 w-7" aria-hidden />
        </button>
      )}
      <p className="truncate font-medium" title={file.fileName}>
        {file.fileName}
      </p>
      <p className="text-muted-foreground">
        {uploaded}
        {file.uploaderName && ` · ${file.uploaderName}`}
      </p>
      <div className="flex flex-wrap gap-x-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Download ${file.fileName}`}
          onClick={() => download.mutate({ fileId: file.id, disposition: "download" })}
        >
          Download
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          disabled={label !== null}
          onClick={() => replaceRef.current?.click()}
        >
          {label ?? "Replace"}
        </button>
        <input
          ref={replaceRef}
          type="file"
          hidden
          accept={CONTRACT_FILE_ACCEPT}
          aria-label={`Replace ${file.fileName}`}
          onChange={(e) => {
            void onReplace(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {canDelete &&
          (confirming ? (
            <>
              <button
                type="button"
                className="font-medium text-red-600 dark:text-red-400"
                onClick={() => remove.mutate({ fileId: file.id })}
              >
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={`Delete ${file.fileName}`}
              className="text-muted-foreground hover:text-red-600"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          ))}
      </div>
      {message && (
        <p className="text-red-600 dark:text-red-400" role="alert">
          {message}
        </p>
      )}
    </li>
  );
}

function AddFilesForm({
  workspaceId,
  contractId,
  onDone,
}: {
  workspaceId: string;
  contractId: string;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { uploadAll, label, percent } = useContractFilesUpload(workspaceId);
  const addFiles = trpc.contract.addFiles.useMutation();

  async function save() {
    setError(null);
    try {
      const attachmentIds = await uploadAll(files);
      await addFiles.mutateAsync({ contractId, attachmentIds });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  const busy = label !== null || addFiles.isPending;
  return (
    <div className="space-y-2" data-testid="contract-add-files">
      <ContractFilePicker files={files} onChange={setFiles} disabled={busy} label="More pages" />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={files.length === 0 || busy}
          onClick={() => void save()}
          data-testid="contract-add-files-save"
        >
          Save pages
        </Button>
        <ContractUploadProgress label={label} percent={percent} />
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function ContractTypeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ContractType | "";
  onChange: (value: ContractType | "") => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ContractType | "")}
      className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
    >
      <option value="">Not set</option>
      {CONTRACT_TYPES.map((t) => (
        <option key={t} value={t}>
          {CONTRACT_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

function EditContractForm({
  workspaceId,
  userId,
  contract: c,
  onDone,
}: {
  workspaceId: string;
  userId: string;
  contract: Contract;
  onDone: () => void;
}) {
  const cache = usePersonCacheUpdate(workspaceId, userId);
  const [title, setTitle] = useState(c.title);
  const [contractType, setContractType] = useState<ContractType | "">(c.contractType ?? "");
  const [startDate, setStartDate] = useState(c.startDate);
  const [expiryDate, setExpiryDate] = useState(c.expiryDate ?? "");
  const update = trpc.contract.update.useMutation({
    ...cache<{
      contractId: string;
      title?: string;
      contractType?: ContractType | null;
      startDate?: string;
      expiryDate?: string | null;
    }>((rows, v) =>
      rows.map((r) =>
        r.id === v.contractId
          ? {
              ...r,
              title: v.title ?? r.title,
              contractType: v.contractType ?? null,
              startDate: v.startDate ?? r.startDate,
              expiryDate: v.expiryDate ?? null,
            }
          : r,
      ),
    ),
    onSuccess: onDone,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      contractId: c.id,
      title: title.trim(),
      contractType: contractType || null,
      startDate,
      expiryDate: expiryDate || null,
    });
  }

  const idPrefix = `contract-edit-${c.id}`;
  return (
    <form
      onSubmit={submit}
      className="bg-muted/40 grid grid-cols-2 gap-3 rounded-md p-3 sm:grid-cols-4"
      data-testid="contract-edit-form"
    >
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <Label htmlFor={`${idPrefix}-title`} className="text-xs">
          Title
        </Label>
        <Input
          id={`${idPrefix}-title`}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-type`} className="text-xs">
          Contract type
        </Label>
        <ContractTypeSelect
          id={`${idPrefix}-type`}
          value={contractType}
          onChange={setContractType}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-start`} className="text-xs">
          Start date
        </Label>
        <Input
          id={`${idPrefix}-start`}
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-end`} className="text-xs">
          End date
        </Label>
        <Input
          id={`${idPrefix}-end`}
          type="date"
          min={startDate}
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
        />
      </div>
      <div className="flex items-end gap-3">
        <Button
          type="submit"
          size="sm"
          disabled={update.isPending}
          data-testid="contract-edit-save"
        >
          Save
        </Button>
      </div>
      {update.error && (
        <p className="col-span-2 text-xs text-red-600 sm:col-span-4 dark:text-red-400" role="alert">
          {update.error.message}
        </p>
      )}
    </form>
  );
}

function AddContractForm({
  workspaceId,
  userId,
  contracts,
  onDone,
}: {
  workspaceId: string;
  userId: string;
  contracts: Contract[];
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<ContractKind>("contract");
  const [parentContractId, setParentContractId] = useState("");
  const [title, setTitle] = useState("");
  const [contractType, setContractType] = useState<ContractType | "">("");
  const [startDate, setStartDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { uploadAll, label, percent } = useContractFilesUpload(workspaceId);
  const create = trpc.contract.create.useMutation();

  const parents = contracts.filter((c) => c.kind === "contract");
  const busy = label !== null || create.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startDate) return;
    if (files.length === 0) {
      setError("Add at least one file");
      return;
    }
    setError(null);
    try {
      const attachmentIds = await uploadAll(files);
      await create.mutateAsync({
        workspaceId,
        userId,
        kind,
        parentContractId: kind === "contract" ? null : parentContractId || null,
        title: title.trim(),
        contractType: contractType || null,
        startDate,
        expiryDate: expiryDate || null,
        attachmentIds,
      });
      void utils.contract.invalidate();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="border-border grid grid-cols-2 gap-3 rounded-md border p-4 sm:grid-cols-3"
      data-testid="contract-form"
    >
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
      <div className="space-y-1">
        <Label htmlFor="contract-type" className="text-xs">
          Contract type
        </Label>
        <ContractTypeSelect id="contract-type" value={contractType} onChange={setContractType} />
      </div>
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
        <Label htmlFor="contract-end" className="text-xs">
          End date (optional)
        </Label>
        <Input
          id="contract-end"
          type="date"
          min={startDate || undefined}
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
        />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <ContractFilePicker files={files} onChange={setFiles} disabled={busy} />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy} data-testid="contract-save">
          Save document
        </Button>
        <ContractUploadProgress label={label} percent={percent} />
        {error && (
          <span className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
