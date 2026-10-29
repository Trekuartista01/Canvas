import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { formatRelativeTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Navigate } from "@tanstack/react-router";
import { Activity, DatabaseBackup, Download, Gauge, HeartPulse } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const adminRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/admin",
  component: AdminPage,
});

function AdminPage() {
  const { workspaceId } = adminRoute.useParams();
  // Same gate as the Platform nav group — owner/admin only. Members who
  // deep-link here are bounced home; API procedures still enforce
  // workspace:manage server-side.
  const workspaces = trpc.workspace.listMine.useQuery();
  const myRole = workspaces.data?.find((w) => w.workspace.id === workspaceId)?.role;
  const allowed = myRole === "owner" || myRole === "admin";

  if (workspaces.isLoading) {
    return (
      <p className="text-muted-foreground p-6 text-sm" data-testid="admin-loading">
        Loading…
      </p>
    );
  }

  if (!allowed) {
    return <Navigate to="/w/$workspaceId" params={{ workspaceId }} replace />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6" data-testid="admin-page">
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Gauge className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Admin</h1>
          <p className="text-muted-foreground text-xs">
            System status, audit log, backups, and your AI quota. Visible to workspace owners and
            admins only.
          </p>
        </div>
      </div>

      <StatusSection workspaceId={workspaceId} />
      <AiQuotaSection workspaceId={workspaceId} />
      <BackupSection workspaceId={workspaceId} />
      <ExportSection workspaceId={workspaceId} />
      <AuditSection workspaceId={workspaceId} />
    </div>
  );
}

function StatusSection({ workspaceId }: { workspaceId: string }) {
  const status = trpc.admin.status.useQuery({ workspaceId });

  return (
    <section className="space-y-2" data-testid="admin-status">
      <div className="flex items-center gap-2">
        <HeartPulse className="text-muted-foreground h-4 w-4" aria-hidden />
        <h2 className="text-sm font-semibold">Status</h2>
      </div>
      <p className="text-muted-foreground text-xs">
        Same checks as <code className="text-foreground">GET /health</code> (API, Postgres, Redis).
      </p>
      {status.isLoading && <p className="text-muted-foreground text-xs">Checking…</p>}
      {status.error && <p className="text-xs text-red-500">{status.error.message}</p>}
      {status.data && (
        <div className="border-border divide-border divide-y rounded-md border text-sm">
          <div className="flex items-center justify-between px-3 py-2">
            <span>Overall</span>
            <StatusPill ok={status.data.ok} />
          </div>
          {Object.entries(status.data.checks).map(([name, value]) => (
            <div key={name} className="flex items-center justify-between px-3 py-2">
              <span className="capitalize">{name}</span>
              <StatusPill ok={value === "ok"} />
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void status.refetch()}
        disabled={status.isFetching}
      >
        Refresh
      </Button>
    </section>
  );
}

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={
        ok
          ? "bg-status-good/15 text-status-good rounded px-2 py-0.5 text-xs font-medium"
          : "bg-status-critical/15 text-status-critical rounded px-2 py-0.5 text-xs font-medium"
      }
    >
      {ok ? "ok" : "error"}
    </span>
  );
}

function AiQuotaSection({ workspaceId }: { workspaceId: string }) {
  const quota = trpc.admin.myAiQuota.useQuery({ workspaceId });
  if (!quota.data) return null;
  const q = quota.data;

  return (
    <section className="space-y-2" data-testid="admin-ai-quota">
      <h2 className="text-sm font-semibold">Your AI quota</h2>
      <ul className="border-border divide-border divide-y rounded-md border text-sm">
        <li className="flex justify-between px-3 py-2">
          <span>Brain messages today</span>
          <span className="font-mono text-xs">
            {q.brainMessagesUsedToday} / {q.brainMessagesPerDay}
          </span>
        </li>
        <li className="flex justify-between px-3 py-2">
          <span>Image generates today</span>
          <span className="font-mono text-xs">
            {q.imageGenerationsUsedToday} / {q.imageGenerationsPerDay}
          </span>
        </li>
        <li className="flex justify-between px-3 py-2">
          <span>Est. spend this month (Canvas-wide, all users)</span>
          <span className="font-mono text-xs">
            ${q.costUsdSpentThisMonth.toFixed(2)} / ${q.costUsdPerMonth}
          </span>
        </li>
      </ul>
    </section>
  );
}

function BackupSection({ workspaceId }: { workspaceId: string }) {
  const guidance = trpc.admin.backupGuidance.useQuery({ workspaceId });

  return (
    <section className="space-y-2" data-testid="admin-backups">
      <div className="flex items-center gap-2">
        <DatabaseBackup className="text-muted-foreground h-4 w-4" aria-hidden />
        <h2 className="text-sm font-semibold">Backups (VPS)</h2>
      </div>
      <p className="text-muted-foreground text-xs">
        Hosting target is a single VPS with Docker Compose. Run these on the box (or via cron).
      </p>
      {guidance.data && (
        <>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
            {guidance.data.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="bg-muted rounded-md p-2 font-mono text-[11px]">
            {guidance.data.restoreHint}
          </p>
        </>
      )}
    </section>
  );
}

// Phase 6: data export (moved here from the removed Developer page in
// M7.0a). Plain <a> links to REST routes (not tRPC — a file download needs
// real Content-Disposition headers), authenticated the same way image
// thumbnails already are: the browser sends the session cookie on
// same-origin navigation, no separate token needed.
function ExportSection({ workspaceId }: { workspaceId: string }) {
  return (
    <section className="space-y-2" data-testid="admin-export">
      <div className="flex items-center gap-2">
        <Download className="text-muted-foreground h-4 w-4" aria-hidden />
        <h2 className="text-sm font-semibold">Export data</h2>
      </div>
      <p className="text-muted-foreground text-xs">
        Download this workspace's tasks as a spreadsheet, or the full task/hierarchy graph as JSON.
      </p>
      <div className="flex gap-2">
        <a
          href={`/export/${workspaceId}/tasks.csv`}
          data-testid="export-tasks-csv"
          download
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Download tasks (CSV)
        </a>
        <a
          href={`/export/${workspaceId}/workspace.json`}
          data-testid="export-workspace-json"
          download
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Download workspace (JSON)
        </a>
      </div>
    </section>
  );
}

function AuditSection({ workspaceId }: { workspaceId: string }) {
  const [actorId, setActorId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [verb, setVerb] = useState("");
  const [debouncedVerb, setDebouncedVerb] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedVerb(verb.trim()), 300);
    return () => clearTimeout(timer);
  }, [verb]);

  const members = trpc.workspace.members.useQuery({ workspaceId });
  const entityTypes = trpc.activity.entityTypes.useQuery({ workspaceId });

  const filters = {
    workspaceId,
    limit: 50,
    actorId: actorId || undefined,
    entityType: entityType || undefined,
    verb: debouncedVerb || undefined,
    // Date inputs are local-midnight `YYYY-MM-DD`; `to` is widened to the
    // end of that day so a same-day range isn't empty.
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
  const hasFilters = Boolean(actorId || entityType || debouncedVerb || from || to);

  const activity = trpc.activity.listWorkspace.useInfiniteQuery(filters, {
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const rows = useMemo(() => activity.data?.pages.flatMap((p) => p.items) ?? [], [activity.data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 8,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = activity;
  const lastIndex = virtualizer.getVirtualItems().at(-1)?.index;
  useEffect(() => {
    if (lastIndex === undefined) return;
    if (lastIndex >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <section className="space-y-2" data-testid="admin-audit">
      <div className="flex items-center gap-2">
        <Activity className="text-muted-foreground h-4 w-4" aria-hidden />
        <h2 className="text-sm font-semibold">Audit log</h2>
      </div>
      <p className="text-muted-foreground text-xs">Workspace activity, newest first.</p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by member"
          data-testid="admin-audit-actor-filter"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          className="border-border bg-background h-7 rounded border text-xs"
        >
          <option value="">All members</option>
          {(members.data ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by entity type"
          data-testid="admin-audit-entity-filter"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="border-border bg-background h-7 rounded border text-xs"
        >
          <option value="">All entity types</option>
          {(entityTypes.data ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Filter by action"
          placeholder="Action contains…"
          data-testid="admin-audit-verb-filter"
          value={verb}
          onChange={(e) => setVerb(e.target.value)}
          className="border-border bg-background h-7 w-36 rounded border px-2 text-xs"
        />
        <input
          type="date"
          aria-label="From date"
          data-testid="admin-audit-from-filter"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="border-border bg-background h-7 rounded border px-1 text-xs"
        />
        <input
          type="date"
          aria-label="To date"
          data-testid="admin-audit-to-filter"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="border-border bg-background h-7 rounded border px-1 text-xs"
        />
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setActorId("");
              setEntityType("");
              setVerb("");
              setFrom("");
              setTo("");
            }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Clear filters
          </button>
        )}
      </div>

      {activity.isLoading && <p className="text-muted-foreground text-xs">Loading…</p>}
      {rows.length === 0 && !activity.isLoading ? (
        <p className="text-muted-foreground text-xs">
          {hasFilters ? "No activity matches these filters." : "No activity yet."}
        </p>
      ) : (
        <div
          ref={parentRef}
          className="border-border h-80 overflow-auto rounded-md border"
          data-testid="admin-audit-list"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={row.id}
                  className="absolute right-0 left-0 flex items-baseline gap-2 border-b px-3 py-2 text-xs"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <span className="text-foreground shrink-0 font-medium">{row.actorName}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">
                    {row.verb} · {row.entityType}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {formatRelativeTime(new Date(row.createdAt))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
