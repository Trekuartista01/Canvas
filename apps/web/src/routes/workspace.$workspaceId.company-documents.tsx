import type { AppRouter } from "@canvas/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openSignedDownload, useCompanyDocumentUpload } from "@/hooks/use-private-upload";
import { formatBytes } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { FolderOpen } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const companyDocumentsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/company-documents",
  component: CompanyDocumentsPage,
});

type Library = inferRouterOutputs<AppRouter>["companyDocument"]["list"];
type Doc = Library["documents"][number];
type Row =
  | { type: "category"; id: string | null; name: string; count: number }
  | { type: "document"; doc: Doc };

// M7.6 company document library: everyone reads and downloads; HR
// (companyDocument:manage) adds categories, uploads and replaces files.
function CompanyDocumentsPage() {
  const { workspaceId } = companyDocumentsRoute.useParams();
  const library = trpc.companyDocument.list.useQuery({ workspaceId });
  const canManage = library.data?.canManage ?? false;

  const rows = useMemo<Row[]>(() => {
    const data = library.data;
    if (!data) return [];
    const groups: { id: string | null; name: string }[] = [
      ...data.categories,
      { id: null, name: "Other" },
    ];
    return groups.flatMap((g) => {
      const docs = data.documents.filter((d) => d.categoryId === g.id);
      // Empty categories still show for HR so they can fill them.
      if (docs.length === 0 && (g.id === null || !canManage)) return [];
      return [
        { type: "category" as const, id: g.id, name: g.name, count: docs.length },
        ...docs.map((doc) => ({ type: "document" as const, doc })),
      ];
    });
  }, [library.data, canManage]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.type === "category" ? 40 : 56),
    overscan: 10,
  });

  return (
    <div
      className="mx-auto flex h-full max-w-4xl flex-col gap-4 p-6"
      data-testid="company-documents-page"
    >
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <FolderOpen className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Company documents</h1>
          <p className="text-muted-foreground text-xs">
            Policies, handbooks and forms for everyone.
          </p>
        </div>
      </div>

      {canManage && library.data && (
        <ManageBar workspaceId={workspaceId} categories={library.data.categories} />
      )}

      {library.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No documents yet.</p>
      ) : (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          data-testid="company-documents-list"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={row.type === "category" ? `c-${row.id ?? "other"}` : row.doc.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.type === "category" ? (
                    <CategoryHeader row={row} canManage={canManage} />
                  ) : (
                    <DocumentRow
                      workspaceId={workspaceId}
                      doc={row.doc}
                      canManage={canManage}
                      categories={library.data?.categories ?? []}
                    />
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

function CategoryHeader({
  row,
  canManage,
}: {
  row: Extract<Row, { type: "category" }>;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.companyDocument.deleteCategory.useMutation({
    onSuccess: () => utils.companyDocument.invalidate(),
  });
  return (
    <h2 className="text-muted-foreground group flex items-center gap-2 px-1 pt-3 text-xs font-semibold tracking-wide uppercase">
      {row.name} <span className="font-normal">· {row.count}</span>
      {canManage && row.id && (
        <button
          type="button"
          className="hidden font-normal normal-case group-hover:inline hover:text-red-600"
          onClick={() => remove.mutate({ categoryId: row.id! })}
        >
          Delete category
        </button>
      )}
    </h2>
  );
}

function DocumentRow({
  workspaceId,
  doc,
  canManage,
  categories,
}: {
  workspaceId: string;
  doc: Doc;
  canManage: boolean;
  categories: Library["categories"];
}) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.companyDocument.invalidate();
  const [showHistory, setShowHistory] = useState(false);
  const versions = trpc.companyDocument.versions.useQuery(
    { documentId: doc.id },
    { enabled: showHistory },
  );
  const download = trpc.companyDocument.downloadUrl.useMutation({
    onSuccess: (r) => openSignedDownload(r.url),
  });
  const replace = trpc.companyDocument.replace.useMutation({ onSuccess: invalidate });
  const update = trpc.companyDocument.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.companyDocument.delete.useMutation({ onSuccess: invalidate });
  const { upload, progress } = useCompanyDocumentUpload(workspaceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function onReplace(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const attachment = await upload(file);
      replace.mutate({ documentId: doc.id, attachmentId: attachment.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div
      className="border-border group space-y-1 rounded-md border px-3 py-2 text-sm"
      data-testid={`company-document-${doc.title}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{doc.title}</span>
        <span className="text-muted-foreground text-xs">
          {doc.fileName} · {formatBytes(doc.sizeBytes ?? 0)}
        </span>
        {doc.versionCount > 1 && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs underline"
            onClick={() => setShowHistory(!showHistory)}
          >
            Version {doc.versionCount}
          </button>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs">
          <Button
            size="sm"
            variant="outline"
            disabled={download.isPending}
            onClick={() => download.mutate({ documentId: doc.id })}
          >
            Download
          </Button>
          {canManage && (
            <>
              <select
                aria-label={`Category of ${doc.title}`}
                value={doc.categoryId ?? ""}
                onChange={(e) =>
                  update.mutate({ documentId: doc.id, categoryId: e.target.value || null })
                }
                className="border-border bg-background h-7 rounded border px-1"
              >
                <option value="">Other</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                aria-label={`Replace ${doc.title}`}
                onChange={(e) => void onReplace(e.target.files?.[0])}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                disabled={progress !== null}
                onClick={() => fileRef.current?.click()}
              >
                {progress !== null ? `Uploading ${progress}%` : "Upload new version"}
              </button>
              <button
                type="button"
                aria-label={`Delete ${doc.title}`}
                className="text-muted-foreground hover:text-red-600"
                onClick={() => remove.mutate({ documentId: doc.id })}
              >
                Delete
              </button>
            </>
          )}
        </span>
      </div>
      {showHistory && (
        <ul
          className="text-muted-foreground space-y-0.5 pl-2 text-xs"
          data-testid="document-versions"
        >
          {(versions.data ?? []).map((v) => (
            <li key={v.id} className="flex gap-2">
              <span>v{v.version}</span>
              <span>{v.fileName}</span>
              <span>{new Date(v.createdAt).toLocaleDateString()}</span>
              {v.uploadedByName && <span>by {v.uploadedByName}</span>}
              {v.isCurrent ? (
                <span className="font-medium">current</span>
              ) : (
                <button
                  type="button"
                  className="hover:text-foreground underline"
                  onClick={() => download.mutate({ documentId: doc.id, versionId: v.id })}
                >
                  Download
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(error ?? replace.error?.message ?? download.error?.message) && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error ?? replace.error?.message ?? download.error?.message}
        </p>
      )}
    </div>
  );
}

function ManageBar({
  workspaceId,
  categories,
}: {
  workspaceId: string;
  categories: Library["categories"];
}) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.companyDocument.invalidate();
  const [categoryName, setCategoryName] = useState("");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, progress } = useCompanyDocumentUpload(workspaceId);
  const createCategory = trpc.companyDocument.createCategory.useMutation({
    onSuccess: () => {
      setCategoryName("");
      void invalidate();
    },
  });
  const create = trpc.companyDocument.create.useMutation({
    onSuccess: () => {
      setTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void invalidate();
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !file) return;
    setError(null);
    try {
      const attachment = await upload(file);
      create.mutate({
        workspaceId,
        categoryId: categoryId || null,
        title: title.trim(),
        attachmentId: attachment.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <div className="border-border space-y-3 rounded-md border p-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={submit}
        data-testid="company-document-form"
      >
        <Input
          placeholder="Document title"
          aria-label="Document title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-8 w-56 text-sm"
        />
        <select
          aria-label="Category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="border-border bg-background h-8 rounded-md border px-2 text-sm"
        >
          <option value="">Other</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          aria-label="Document file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || !file || progress !== null || create.isPending}
          data-testid="company-document-save"
        >
          {progress !== null ? `Uploading ${progress}%` : "Add document"}
        </Button>
      </form>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (categoryName.trim())
            createCategory.mutate({ workspaceId, name: categoryName.trim() });
        }}
      >
        <Input
          placeholder="New category (e.g. Policies)"
          aria-label="New category"
          value={categoryName}
          onChange={(e) => setCategoryName(e.target.value)}
          className="h-8 w-56 text-sm"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!categoryName.trim()}>
          Add category
        </Button>
      </form>
      {(error ?? create.error?.message ?? createCategory.error?.message) && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error ?? create.error?.message ?? createCategory.error?.message}
        </p>
      )}
    </div>
  );
}
