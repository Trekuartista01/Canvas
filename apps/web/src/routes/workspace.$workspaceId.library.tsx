import type { AppRouter } from "@canvas/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageVersionThumb } from "@/components/image-version-thumb";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import { IMAGE_LIBRARY_ORIGINS, type ImageLibraryOrigin } from "@canvas/shared";
import { createRoute } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterOutputs } from "@trpc/server";
import {
  Check,
  ChevronLeft,
  Copy as CopyIcon,
  Download,
  FolderPlus,
  Images,
  Loader2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type LibraryItem = RouterOutputs["imageAsset"]["library"]["items"][number];
type LibraryFolder = RouterOutputs["imageFolder"]["list"][number];
type LibraryCopyItem = RouterOutputs["copywriter"]["listLibraryItems"][number];

export const libraryRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/library",
  component: LibraryPage,
});

const ORIGIN_TAB_LABELS: Record<ImageLibraryOrigin, string> = {
  all: "All",
  generation: "Generated",
  upload: "Uploaded",
};

// Tile footprint including gap, used both for the CSS grid and to work out
// how many columns fit so rows can be virtualized (TanStack Virtual doesn't
// virtualize 2D grids directly — chunking into fixed-size rows is the
// standard way around that, same idea as this app's other virtualized views
// just applied to rows-of-tiles instead of rows-of-table-cells).
const TILE_WIDTH = 128;
const TILE_GAP = 12;
const ROW_HEIGHT = 128 + 20 + TILE_GAP; // thumb + caption + gap
const COPY_ITEM_ROW_HEIGHT = 92; // saved-copy card + gap, in the Copy > brand kit view

function LibraryPage() {
  const { workspaceId } = libraryRoute.useParams();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [origin, setOrigin] = useState<ImageLibraryOrigin>("all");
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [openAssetId, setOpenAssetId] = useState<string | null>(null);

  const folders = trpc.imageFolder.list.useQuery({ workspaceId });
  const createFolder = trpc.imageFolder.create.useMutation({
    onSuccess: (folder) => {
      void utils.imageFolder.list.invalidate({ workspaceId });
      setFolderId(folder.id);
      setNewFolderName("");
      setAddingFolder(false);
    },
  });
  const deleteFolder = trpc.imageFolder.delete.useMutation({
    onSuccess: (_result, variables) => {
      void utils.imageFolder.list.invalidate({ workspaceId });
      void utils.imageAsset.library.invalidate({ workspaceId });
      if (folderId === variables.folderId) setFolderId(undefined);
    },
  });
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  function handleCreateFolder(e: FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    createFolder.mutate({ workspaceId, name });
  }

  // The Copywriter's "Copy" folder is the one place this page's folders
  // nest (Copy > one child per brand kit — see lib/copy-library.ts on the
  // API side). Everywhere else stays flat: the "New folder" button never
  // creates children, so this is the only nesting ever encountered here.
  const activeFolder = folders.data?.find((f) => f.id === folderId);
  const copyRootFolder = folders.data?.find((f) => f.kind === "copy_root");
  const isBrowsingCopyChildren =
    activeFolder?.kind === "copy_root" || activeFolder?.kind === "copy_client";
  // Top level shows every root folder (user-created "custom" ones plus the
  // system-managed "Copy" root, if it exists yet) side by side; drilling
  // into "Copy" swaps to its brand-kit children instead.
  const visibleFolders = isBrowsingCopyChildren
    ? (folders.data?.filter((f) => f.parentFolderId === copyRootFolder?.id) ?? [])
    : (folders.data?.filter((f) => f.parentFolderId === null) ?? []);

  const [openCopyItemId, setOpenCopyItemId] = useState<string | null>(null);
  const copyItems = trpc.copywriter.listLibraryItems.useQuery(
    { folderId: activeFolder?.id ?? "" },
    { enabled: activeFolder?.kind === "copy_client" },
  );
  const deleteCopyItem = trpc.copywriter.deleteLibraryItem.useMutation({
    onSuccess: () => {
      void utils.copywriter.listLibraryItems.invalidate({ folderId: activeFolder?.id ?? "" });
      setOpenCopyItemId(null);
    },
  });
  const openCopyItem = copyItems.data?.find((i) => i.id === openCopyItemId) ?? null;

  const copyListRef = useRef<HTMLDivElement>(null);
  const copyItemsList = copyItems.data ?? [];
  const copyVirtualizer = useVirtualizer({
    count: copyItemsList.length,
    getScrollElement: () => copyListRef.current,
    estimateSize: () => COPY_ITEM_ROW_HEIGHT,
    overscan: 6,
  });

  const library = trpc.imageAsset.library.useInfiniteQuery(
    { workspaceId, search: debouncedSearch || undefined, origin, folderId },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  const items = useMemo(() => library.data?.pages.flatMap((p) => p.items) ?? [], [library.data]);

  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observe = () =>
      setColumns(Math.max(1, Math.floor(el.clientWidth / (TILE_WIDTH + TILE_GAP))));
    observe();
    const observer = new ResizeObserver(observe);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => {
    const chunked: LibraryItem[][] = [];
    for (let i = 0; i < items.length; i += columns) chunked.push(items.slice(i, i + columns));
    return chunked;
  }, [items, columns]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => gridRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const lastRowIndex = virtualRows.at(-1)?.index;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = library;
  useEffect(() => {
    if (lastRowIndex === undefined) return;
    if (lastRowIndex >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [lastRowIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const deleteAsset = trpc.imageAsset.delete.useMutation({
    onSuccess: () => {
      void utils.imageAsset.library.invalidate({ workspaceId });
      setOpenAssetId(null);
    },
  });
  const moveAsset = trpc.imageAsset.moveToFolder.useMutation({
    onSuccess: () => void utils.imageAsset.library.invalidate({ workspaceId }),
  });

  const openAsset = items.find((i) => i.id === openAssetId) ?? null;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      // Uploads land in whichever folder is currently being viewed — the
      // same "you're looking at where it'll go" convention as Drive/Dropbox.
      if (folderId) form.set("folderId", folderId);
      form.set("file", file);
      const response = await fetch("/image-assets/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Upload failed");
      void utils.imageAsset.library.invalidate({ workspaceId });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-full flex-col p-6" data-testid="library-page">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
            <Images className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Library</h1>
            <p className="text-muted-foreground text-xs">
              Every image you've generated or uploaded, saved here in Canvas — not just on your
              device.
            </p>
          </div>
        </div>

        {!isBrowsingCopyChildren && (
          <div className="flex flex-col items-end gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelected}
              className="hidden"
              data-testid="library-upload-input"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="library-upload-button"
              className="gap-1.5"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <UploadCloud className="h-3.5 w-3.5" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Upload image"}
            </Button>
            {uploadError && <p className="text-status-critical text-xs">{uploadError}</p>}
          </div>
        )}
      </div>

      {!isBrowsingCopyChildren && (
        <div className="mb-3 flex items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by alt text or tag…"
            className="h-8 max-w-xs text-sm"
            data-testid="library-search"
          />
          <div className="flex gap-1">
            {IMAGE_LIBRARY_ORIGINS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrigin(o)}
                data-testid={`library-origin-${o}`}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  origin === o
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {ORIGIN_TAB_LABELS[o]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {isBrowsingCopyChildren ? (
          <button
            type="button"
            onClick={() =>
              setFolderId(activeFolder?.kind === "copy_client" ? copyRootFolder?.id : undefined)
            }
            data-testid="library-folder-back"
            className="border-border text-muted-foreground hover:bg-muted flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
          >
            <ChevronLeft className="h-3 w-3" aria-hidden />
            Back
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setFolderId(undefined)}
            data-testid="library-folder-all"
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              folderId === undefined
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            All folders
          </button>
        )}
        {visibleFolders.map((folder) => (
          <span
            key={folder.id}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
              folderId === folder.id
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <button
              type="button"
              onClick={() => setFolderId(folder.id)}
              data-testid={`library-folder-${folder.id}`}
              className="flex items-center gap-1"
            >
              {folder.kind === "copy_root" && <CopyIcon className="h-3 w-3" aria-hidden />}
              {folder.name}
            </button>
            {/* Copy root/client folders are auto-provisioned by the Copywriter
                (see lib/copy-library.ts) — not user-deletable from here. */}
            {folder.kind === "custom" && (
              <button
                type="button"
                onClick={() => deleteFolder.mutate({ folderId: folder.id })}
                aria-label={`Delete folder ${folder.name}`}
                title={`Delete folder ${folder.name}`}
                data-testid={`library-folder-delete-${folder.id}`}
                className="hover:text-status-critical"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {!isBrowsingCopyChildren &&
          (addingFolder ? (
            <form onSubmit={handleCreateFolder} className="flex items-center gap-1">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name, e.g. Zone Club"
                className="h-7 w-40 text-xs"
                data-testid="library-folder-new-name"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={createFolder.isPending || !newFolderName.trim()}
                data-testid="library-folder-new-submit"
              >
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAddingFolder(false);
                  setNewFolderName("");
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingFolder(true)}
              data-testid="library-folder-new"
              className="border-border text-muted-foreground hover:bg-muted flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs"
            >
              <FolderPlus className="h-3 w-3" aria-hidden />
              New folder
            </button>
          ))}
      </div>

      {activeFolder?.kind === "copy_root" ? (
        <div
          className="text-muted-foreground rounded-md border p-6 text-center text-sm"
          data-testid="library-empty"
        >
          Pick a brand kit above to view its saved copy.
        </div>
      ) : activeFolder?.kind === "copy_client" ? (
        copyItems.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : copyItemsList.length === 0 ? (
          <div
            className="text-muted-foreground rounded-md border p-6 text-center text-sm"
            data-testid="library-empty"
          >
            No copy saved for this brand kit yet — use "Save to Library" from the Copywriter.
          </div>
        ) : (
          <div
            ref={copyListRef}
            className="min-h-0 flex-1 overflow-y-auto"
            data-testid="library-copy-list"
          >
            <div style={{ height: copyVirtualizer.getTotalSize(), position: "relative" }}>
              {copyVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = copyItemsList[virtualRow.index];
                if (!item) return null;
                return (
                  <div
                    key={item.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="pb-2"
                  >
                    <CopyItemCard item={item} onSelect={() => setOpenCopyItemId(item.id)} />
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : library.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <div
          className="text-muted-foreground rounded-md border p-6 text-center text-sm"
          data-testid="library-empty"
        >
          {debouncedSearch || origin !== "all" || folderId !== undefined
            ? "No images match this search/filter."
            : "No images yet — generate or upload one and it'll show up here."}
        </div>
      ) : (
        <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="library-grid">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {virtualRows.map((virtualRow) => (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex gap-3"
              >
                {rows[virtualRow.index]?.map((asset) => (
                  <div
                    key={asset.id}
                    data-testid={`library-item-${asset.id}`}
                    className="flex w-32 flex-col items-start gap-1"
                  >
                    {asset.currentVersionId ? (
                      <ImageVersionThumb
                        version={{ id: asset.currentVersionId, blurhash: asset.blurhash }}
                        onSelect={() => setOpenAssetId(asset.id)}
                      />
                    ) : (
                      <div className="border-border bg-muted flex h-28 w-28 items-center justify-center rounded-md border">
                        <Loader2
                          className="text-muted-foreground h-5 w-5 animate-spin"
                          aria-hidden
                        />
                      </div>
                    )}
                    <span className="text-muted-foreground w-28 truncate text-[11px]">
                      {asset.altText ??
                        (asset.origin === "generation" ? "Generated image" : "Uploaded image")}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {library.isFetchingNextPage && (
            <p className="text-muted-foreground py-2 text-center text-xs">Loading more…</p>
          )}
        </div>
      )}

      {openAsset && (
        <LibraryDetailPanel
          asset={openAsset}
          // Only user-created folders are offered here — the Copy root/client
          // folders are Copywriter-managed (see lib/copy-library.ts) and
          // never hold image assets.
          folders={folders.data?.filter((f) => f.kind === "custom") ?? []}
          onClose={() => setOpenAssetId(null)}
          onDelete={() => deleteAsset.mutate({ assetId: openAsset.id })}
          deleting={deleteAsset.isPending}
          onMove={(newFolderId) =>
            moveAsset.mutate({ assetId: openAsset.id, folderId: newFolderId })
          }
          moving={moveAsset.isPending}
        />
      )}

      {openCopyItem && (
        <LibraryCopyItemDetailPanel
          item={openCopyItem}
          onClose={() => setOpenCopyItemId(null)}
          onDelete={() => deleteCopyItem.mutate({ itemId: openCopyItem.id })}
          deleting={deleteCopyItem.isPending}
        />
      )}
    </div>
  );
}

function CopyItemCard({ item, onSelect }: { item: LibraryCopyItem; onSelect: () => void }) {
  const preview = item.text ?? item.designCopy ?? item.caption ?? "";
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`library-copy-item-${item.id}`}
      className="border-border hover:bg-muted flex w-full flex-col items-start gap-1 rounded-md border p-3 text-left text-xs"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <CopyIcon className="h-3.5 w-3.5" aria-hidden />
        {item.label}
      </span>
      <span className="text-muted-foreground line-clamp-2">{preview}</span>
      <span className="text-muted-foreground text-[11px]">
        {item.copyType} · {item.length} · {item.language}
      </span>
    </button>
  );
}

function LibraryCopyItemDetailPanel({
  item,
  onClose,
  onDelete,
  deleting,
}: {
  item: LibraryCopyItem;
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { containerRef, onKeyDown } = useModalA11y(onClose);

  async function handleCopy() {
    const bodyText = item.text ?? [item.designCopy, item.caption].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(bodyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div data-testid="library-copy-detail-panel" className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Close copy detail"
        title="Close copy detail"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={item.label}
        tabIndex={-1}
        className="border-border bg-background relative flex h-full w-full max-w-md flex-col border-l shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">{item.label}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          <p className="text-muted-foreground text-xs">
            {item.copyType} · {item.length} · {item.language} ·{" "}
            {new Date(item.createdAt).toLocaleString()}
          </p>
          {item.text && <p className="whitespace-pre-wrap">{item.text}</p>}
          {item.designCopy && (
            <div>
              <p className="text-xs font-medium">Design copy</p>
              <p className="whitespace-pre-wrap">{item.designCopy}</p>
            </div>
          )}
          {item.caption && (
            <div>
              <p className="text-xs font-medium">Caption</p>
              <p className="whitespace-pre-wrap">{item.caption}</p>
            </div>
          )}
        </div>

        <div className="border-border flex gap-2 border-t p-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="gap-1.5"
            data-testid="library-copy-item-copy"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <CopyIcon className="h-3.5 w-3.5" aria-hidden />
            )}
            {copied ? "Copied" : "Copy text"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={deleting}
            data-testid="library-copy-item-delete"
            className="text-status-critical gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LibraryDetailPanel({
  asset,
  folders,
  onClose,
  onDelete,
  deleting,
  onMove,
  moving,
}: {
  asset: LibraryItem;
  folders: Pick<LibraryFolder, "id" | "name">[];
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
  onMove: (folderId: string | null) => void;
  moving: boolean;
}) {
  const { containerRef, onKeyDown } = useModalA11y(onClose);

  return (
    <div data-testid="library-detail-panel" className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Close image detail"
        title="Close image detail"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={asset.altText ?? "Image detail"}
        tabIndex={-1}
        className="border-border bg-background relative flex h-full w-full max-w-md flex-col border-l shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">Image</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {asset.currentVersionId ? (
            <img
              src={`/image-versions/${asset.currentVersionId}`}
              alt={asset.altText ?? "Saved image"}
              className="border-border w-full rounded-md border"
            />
          ) : (
            <p className="text-muted-foreground text-xs">Still generating…</p>
          )}

          {asset.prompt && (
            <p className="text-xs">
              <span className="font-medium">Prompt:</span> {asset.prompt}
            </p>
          )}
          {asset.altText && (
            <p className="text-xs">
              <span className="font-medium">Alt text:</span> {asset.altText}
            </p>
          )}
          {(asset.tagsJson?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {asset.tagsJson?.map((tag) => (
                <span key={tag} className="bg-muted rounded-full px-2 py-0.5 text-[11px]">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            {asset.origin === "generation" ? "Generated" : "Uploaded"} ·{" "}
            {new Date(asset.createdAt).toLocaleString()}
          </p>

          <label className="block text-xs">
            <span className="text-muted-foreground mb-1 block font-medium">Folder</span>
            <select
              value={asset.folderId ?? ""}
              onChange={(e) => onMove(e.target.value || null)}
              disabled={moving}
              data-testid="library-move-folder"
              className="border-border bg-background h-8 w-full rounded border text-sm"
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="border-border flex gap-2 border-t p-4">
          {asset.currentVersionId && (
            <a
              href={`/image-versions/${asset.currentVersionId}?download=1`}
              download
              data-testid="library-download"
              className="border-border hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download
            </a>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={deleting}
            data-testid="library-delete"
            className="text-status-critical gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
