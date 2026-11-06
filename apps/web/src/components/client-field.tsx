import { Section } from "@/components/detail-field";
import { Input } from "@/components/ui/input";
import { useMyAccess } from "@/hooks/use-my-access";
import { trpc } from "@/lib/trpc";
import { useMemo, useRef, useState } from "react";

interface ClientRef {
  id: string;
  name: string;
  color: string;
}

function Chip({ client, label }: { client: ClientRef; label?: string }) {
  return (
    <span
      className="rounded-full px-3.5 py-1.5 text-base font-semibold"
      style={{ backgroundColor: `${client.color}26`, color: client.color }}
      data-testid="card-client-chip"
    >
      {label ? `${label}: ` : ""}
      {client.name}
    </span>
  );
}

/**
 * P8.10 (spec §11): the card's Client. Detection fills it; anyone who can edit
 * the card can clear it or pick from what was detected. The full client list and
 * "+ New client" are for clients:manage only, and the server enforces the same.
 */
export function ClientField({
  workspaceId,
  taskId,
  client,
  detected,
  suggestions,
}: {
  workspaceId: string;
  taskId: string;
  client: ClientRef | null;
  detected: boolean;
  suggestions: ClientRef[];
}) {
  const utils = trpc.useUtils();
  const access = useMyAccess(workspaceId);
  const canManage = access.can("clients:manage");
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  // The button just used may be gone after a change. Focus stays in the panel,
  // so Escape still closes it.
  const fieldRef = useRef<HTMLDivElement>(null);
  const options = trpc.clients.options.useQuery(
    { workspaceId, includeArchived: false },
    { enabled: canManage && picking },
  );

  const invalidate = () => {
    void utils.task.get.invalidate({ taskId });
    void utils.task.board.invalidate();
    void utils.clients.invalidate();
  };
  const set = trpc.task.setClient.useMutation({
    onSuccess: () => {
      invalidate();
      setPicking(false);
      setSearch("");
      fieldRef.current?.focus();
    },
  });
  const create = trpc.clients.create.useMutation({
    onSuccess: (created) => set.mutate({ taskId, clientId: created.id }),
  });

  const q = search.trim().toLowerCase();
  const matches = useMemo(
    () => (options.data ?? []).filter((o) => !q || o.name.toLowerCase().includes(q)),
    [options.data, q],
  );
  const exact = (options.data ?? []).some((o) => o.name.toLowerCase() === q);
  const error = set.error ?? create.error;

  return (
    <Section label="Client">
      <div
        ref={fieldRef}
        tabIndex={-1}
        className="flex min-h-10 flex-wrap items-center gap-2 text-sm outline-none"
        data-testid="card-client"
      >
        {client ? (
          <>
            <Chip client={client} label={detected ? "Detected" : undefined} />
            <button
              type="button"
              aria-label="Clear client"
              className="text-muted-foreground hover:text-foreground"
              disabled={set.isPending}
              onClick={() => set.mutate({ taskId, clientId: null })}
            >
              ✕
            </button>
          </>
        ) : suggestions.length === 0 ? (
          <span className="text-muted-foreground">No client yet</span>
        ) : null}

        {suggestions.length > 0 && (
          <span className="flex flex-wrap items-center gap-1" data-testid="card-client-suggestions">
            <span className="text-muted-foreground">Mentions:</span>
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="border-border hover:bg-muted rounded-full border px-3 py-1 font-medium"
                disabled={set.isPending}
                onClick={() => set.mutate({ taskId, clientId: s.id })}
              >
                {s.name}
              </button>
            ))}
          </span>
        )}

        {canManage && (
          <button
            type="button"
            className="border-border hover:bg-muted h-9 rounded-md border px-3 text-sm font-medium"
            onClick={() => setPicking(!picking)}
          >
            {picking ? "Close" : client ? "Change" : "Choose"}
          </button>
        )}
      </div>

      {picking && (
        <div className="mt-2 max-w-sm space-y-1" data-testid="card-client-picker">
          <Input
            autoFocus
            value={search}
            placeholder="Search clients"
            aria-label="Search clients"
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <ul className="border-border max-h-48 overflow-y-auto rounded-md border text-sm">
            {matches.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="hover:bg-muted block w-full px-3 py-2 text-left"
                  onClick={() => set.mutate({ taskId, clientId: o.id })}
                >
                  {o.name}
                </button>
              </li>
            ))}
            {q && !exact && (
              <li>
                <button
                  type="button"
                  className="hover:bg-muted text-accent block w-full px-3 py-2 text-left"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ workspaceId, name: search.trim(), aliases: [] })}
                >
                  + New client "{search.trim()}"
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error.message}
        </p>
      )}
    </Section>
  );
}
