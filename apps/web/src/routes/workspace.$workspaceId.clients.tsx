import type { AppRouter } from "@canvas/api";
import { RequireAccess } from "@/components/require-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { createRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Building2 } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const clientsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/clients",
  component: GuardedClientsPage,
});

function GuardedClientsPage() {
  const { workspaceId } = clientsRoute.useParams();
  return (
    <RequireAccess workspaceId={workspaceId} action="clients:manage">
      <ClientsPage />
    </RequireAccess>
  );
}

type Client = inferRouterOutputs<AppRouter>["clients"]["list"][number];

const FOLDER_WIDTH = 220;
const ROW_HEIGHT = 128;

/** "Zone, Zone Club Prishtina" → ["Zone", "Zone Club Prishtina"]. */
export function parseAliases(text: string) {
  return text
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export function ClientMark({
  client,
  size = "h-10 w-10",
}: {
  client: { name: string; color: string; logoUrl?: string | null };
  size?: string;
}) {
  if (client.logoUrl) {
    return (
      <img
        src={client.logoUrl}
        alt=""
        className={`${size} border-border shrink-0 rounded-md border object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${size} flex shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white`}
      style={{ backgroundColor: client.color }}
    >
      {client.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// P8.10 (spec §11): a folder per client. A folder is a filtered view of cards on
// their boards: nothing is copied or moved.
function ClientsPage() {
  const { workspaceId } = clientsRoute.useParams();
  const [includeArchived, setIncludeArchived] = useState(false);
  const clients = trpc.clients.list.useQuery({ workspaceId, includeArchived });
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients.data ?? []).filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.aliases.some((alias) => alias.toLowerCase().includes(q)),
    );
  }, [clients.data, search]);

  // A virtualized grid: as many folders per row as fit the width.
  const parentRef = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(4);
  const measure = (node: HTMLDivElement | null) => {
    parentRef.current = node;
    if (node) setPerRow(Math.max(1, Math.floor(node.clientWidth / FOLDER_WIDTH)));
  };
  const rowCount = Math.ceil(rows.length / perRow);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  return (
    <div
      className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-4 sm:p-6"
      data-testid="clients-page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mr-auto text-lg font-semibold">Clients</h1>
        <Input
          placeholder="Search clients"
          aria-label="Search clients"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <Button size="sm" onClick={() => setAdding(!adding)} data-testid="client-add">
          {adding ? "Close" : "New client"}
        </Button>
      </div>

      {adding && <NewClientForm workspaceId={workspaceId} onDone={() => setAdding(false)} />}

      {clients.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : clients.error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {clients.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No clients yet.</p>
      ) : (
        <div ref={measure} className="min-h-0 flex-1 overflow-auto" data-testid="client-folders">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.index}
                className="absolute right-0 left-0 grid gap-3 pb-3"
                style={{
                  transform: `translateY(${item.start}px)`,
                  gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`,
                }}
              >
                {rows.slice(item.index * perRow, (item.index + 1) * perRow).map((client) => (
                  <ClientFolder key={client.id} workspaceId={workspaceId} client={client} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClientFolder({ workspaceId, client }: { workspaceId: string; client: Client }) {
  return (
    <Link
      to="/w/$workspaceId/clients/$clientId"
      params={{ workspaceId, clientId: client.id }}
      data-testid={`client-folder-${client.name}`}
      className={`border-border hover:bg-muted flex h-28 flex-col justify-between rounded-lg border p-3 ${
        client.archivedAt ? "opacity-60" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ClientMark client={client} />
        <span className="truncate text-sm font-semibold">{client.name}</span>
      </span>
      <span className="text-muted-foreground text-xs" data-testid="client-open-tasks">
        {client.archivedAt
          ? "Archived"
          : `${client.openTasks} open ${client.openTasks === 1 ? "task" : "tasks"}`}
      </span>
    </Link>
  );
}

function NewClientForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const create = trpc.clients.create.useMutation({
    onSuccess: () => {
      void utils.clients.invalidate();
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ workspaceId, name: name.trim(), aliases: parseAliases(aliases) });
  }

  return (
    <form
      onSubmit={submit}
      className="border-border grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_2fr_auto]"
      data-testid="client-form"
    >
      <div className="space-y-1">
        <Label htmlFor="client-name" className="text-xs">
          Name
        </Label>
        <Input
          id="client-name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="client-aliases" className="text-xs">
          Other names, separated by commas
        </Label>
        <Input
          id="client-aliases"
          placeholder="Zone, Zone Club Prishtina"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" size="sm" disabled={create.isPending} data-testid="client-save">
          Add client
        </Button>
      </div>
      {create.error && (
        <p className="text-xs text-red-600 sm:col-span-3 dark:text-red-400" role="alert">
          {create.error.message}
        </p>
      )}
    </form>
  );
}
