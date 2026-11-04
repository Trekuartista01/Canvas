import type { AppRouter } from "@canvas/api";
import { RequireAccess } from "@/components/require-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { putWithProgress } from "@/hooks/use-attachment-upload";
import { trpc } from "@/lib/trpc";
import { LOGO_MIME_TYPES, MAX_LOGO_BYTES, formatDmy } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";
import { ClientMark, parseAliases } from "./workspace.$workspaceId.clients";

export const clientFolderRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/clients/$clientId",
  component: GuardedClientFolderPage,
});

function GuardedClientFolderPage() {
  const { workspaceId } = clientFolderRoute.useParams();
  return (
    <RequireAccess workspaceId={workspaceId} action="clients:manage">
      <ClientFolderPage />
    </RequireAccess>
  );
}

type Folder = inferRouterOutputs<AppRouter>["clients"]["folder"];
type FolderTask = Folder["tasks"][number];
type Row =
  | { type: "group"; key: string; spaceName: string; listName: string; count: number }
  | { type: "task"; key: string; task: FolderTask };

// Every card linked to this client, across all boards, grouped by board and
// list. The cards stay where they are; each row opens the card on its board.
function ClientFolderPage() {
  const { workspaceId, clientId } = clientFolderRoute.useParams();
  const folder = trpc.clients.folder.useQuery({ clientId });
  const [editing, setEditing] = useState(false);

  const rows = useMemo(() => {
    const groups = new Map<string, FolderTask[]>();
    for (const task of folder.data?.tasks ?? []) {
      groups.set(task.listId, [...(groups.get(task.listId) ?? []), task]);
    }
    const out: Row[] = [];
    for (const [listId, tasks] of groups) {
      const first = tasks[0]!;
      out.push({
        type: "group",
        key: `group-${listId}`,
        spaceName: first.spaceName,
        listName: first.listName,
        count: tasks.length,
      });
      for (const task of tasks) out.push({ type: "task", key: task.id, task });
    }
    return out;
  }, [folder.data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  if (folder.isLoading) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  if (!folder.data) {
    return (
      <p className="p-6 text-sm text-red-600 dark:text-red-400" role="alert">
        {folder.error?.message ?? "This client doesn't exist."}
      </p>
    );
  }
  const { client } = folder.data;

  return (
    <div
      className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-4 sm:p-6"
      data-testid="client-folder-page"
    >
      <div className="flex flex-wrap items-center gap-3">
        <ClientMark client={client} />
        <div className="mr-auto min-w-0">
          <p className="text-muted-foreground text-xs">
            <Link to="/w/$workspaceId/clients" params={{ workspaceId }} className="hover:underline">
              Clients
            </Link>
          </p>
          <h1 className="truncate text-lg font-semibold">
            {client.name}
            {client.archivedAt && (
              <span className="text-muted-foreground ml-2 text-xs font-normal">Archived</span>
            )}
          </h1>
          {client.aliases.length > 0 && (
            <p className="text-muted-foreground truncate text-xs">
              Also known as {client.aliases.join(", ")}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
          {editing ? "Close" : "Edit"}
        </Button>
      </div>

      {editing && (
        <EditClient
          client={client}
          onDone={() => setEditing(false)}
        />
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No cards are linked to this client yet.</p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="client-tasks">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute right-0 left-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.type === "group" ? (
                    <h2 className="text-muted-foreground px-1 pt-3 pb-1 text-xs font-medium">
                      {row.spaceName} / {row.listName} ({row.count})
                    </h2>
                  ) : (
                    <Link
                      to="/w/$workspaceId/boards"
                      params={{ workspaceId }}
                      search={{ board: row.task.spaceId, card: row.task.id }}
                      className="border-border hover:bg-muted flex flex-wrap items-center gap-x-3 border-b px-2 py-2 text-sm"
                      data-testid={`client-task-${row.task.title}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{row.task.title}</span>
                      {row.task.dueDate && (
                        <span className="text-muted-foreground text-xs">
                          {formatDmy(row.task.dueDate)}
                        </span>
                      )}
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{
                          backgroundColor: `${row.task.statusColor}26`,
                          color: row.task.statusColor,
                        }}
                      >
                        {row.task.statusName}
                      </span>
                    </Link>
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

function EditClient({ client, onDone }: { client: Folder["client"]; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(client.name);
  const [aliases, setAliases] = useState(client.aliases.join(", "));
  const [color, setColor] = useState(client.color);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const invalidate = () => void utils.clients.invalidate();
  const update = trpc.clients.update.useMutation({ onSuccess: invalidate });
  const archive = trpc.clients.setArchived.useMutation({ onSuccess: invalidate });
  const presign = trpc.clients.presignLogo.useMutation();

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate(
      { clientId: client.id, name: name.trim(), aliases: parseAliases(aliases), color },
      { onSuccess: onDone },
    );
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    const mime = LOGO_MIME_TYPES.find((m) => m === file.type);
    if (!mime) return setLogoError("Logos can be PNG, JPG or WebP");
    if (file.size > MAX_LOGO_BYTES) return setLogoError("Logos can be up to 5 MB");
    setUploading(true);
    try {
      const { key, uploadUrl } = await presign.mutateAsync({
        clientId: client.id,
        fileName: file.name,
        mime,
      });
      await putWithProgress(uploadUrl, file, mime, () => undefined);
      await update.mutateAsync({ clientId: client.id, logoKey: key });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const error = update.error ?? archive.error;
  return (
    <form
      onSubmit={submit}
      className="border-border grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_2fr_auto]"
      data-testid="client-edit-form"
    >
      <div className="space-y-1">
        <Label htmlFor="client-edit-name" className="text-xs">
          Name
        </Label>
        <Input
          id="client-edit-name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="client-edit-aliases" className="text-xs">
          Other names, separated by commas
        </Label>
        <Input
          id="client-edit-aliases"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="client-edit-color" className="text-xs">
          Colour
        </Label>
        <input
          id="client-edit-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="border-border h-9 w-14 rounded border"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" size="sm" disabled={update.isPending} data-testid="client-edit-save">
          Save
        </Button>
        <label className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
          {uploading ? "Uploading…" : "Upload a logo"}
          <input
            type="file"
            hidden
            aria-label="Client logo"
            accept={LOGO_MIME_TYPES.join(",")}
            disabled={uploading}
            onChange={(e) => {
              void uploadLogo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {client.hasLogo && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={() => update.mutate({ clientId: client.id, logoKey: null })}
          >
            Remove logo
          </button>
        )}
        <button
          type="button"
          className="text-muted-foreground ml-auto text-xs hover:text-red-600"
          disabled={archive.isPending}
          onClick={() =>
            archive.mutate({ clientId: client.id, archived: !client.archivedAt })
          }
          data-testid="client-archive"
        >
          {client.archivedAt ? "Restore client" : "Archive client"}
        </button>
      </div>
      {(error ?? logoError) && (
        <p className="text-xs text-red-600 sm:col-span-3 dark:text-red-400" role="alert">
          {error?.message ?? logoError}
        </p>
      )}
    </form>
  );
}
