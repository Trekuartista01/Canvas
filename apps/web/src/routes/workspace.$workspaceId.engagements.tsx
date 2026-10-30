import type { AppRouter } from "@canvas/api";
import { Input } from "@/components/ui/input";
import { formatDue } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { Activity } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const engagementsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/engagements",
  component: EngagementsPage,
});

type Card = inferRouterOutputs<AppRouter>["performance"]["engagements"][number];
type Status = Card["status"];

const STATUS: Record<Status, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "bg-red-500/15 text-red-700 dark:text-red-300" },
  due_today: {
    label: "Due today",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  on_track: { label: "On track", className: "bg-green-500/15 text-green-700 dark:text-green-300" },
};
const PER_ROW = 3;

/** "2026-11-02T09:00:00" → "2 Nov, 09:00"; an all-day deadline shows just the date. */
function formatDeadline(key: string) {
  const [date, time] = key.split("T") as [string, string];
  return formatDue(date, time === "23:59:59" ? null : time);
}

// M7.8 live board (report:viewTeam; a staff manager sees their reports).
// Live through the ordinary task WS invalidation — use-realtime.ts
// invalidates this query on every task event.
function EngagementsPage() {
  const { workspaceId } = engagementsRoute.useParams();
  const board = trpc.performance.engagements.useQuery({ workspaceId });
  const [filter, setFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");

  const cards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (board.data ?? []).filter(
      (c) => (filter === "all" || c.status === filter) && (!q || c.name.toLowerCase().includes(q)),
    );
  }, [board.data, filter, search]);
  const rows = useMemo(() => {
    const out: Card[][] = [];
    for (let i = 0; i < cards.length; i += PER_ROW) out.push(cards.slice(i, i + PER_ROW));
    return out;
  }, [cards]);
  const counts = useMemo(() => {
    const c = { overdue: 0, due_today: 0, on_track: 0 };
    for (const card of board.data ?? []) c[card.status]++;
    return c;
  }, [board.data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 190,
    overscan: 4,
  });

  return (
    <div
      className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6"
      data-testid="engagements-page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Activity className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Engagements</h1>
          <p className="text-muted-foreground text-xs">What everyone is working on right now.</p>
        </div>
        <Input
          placeholder="Search people"
          aria-label="Search people"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-48 text-sm"
        />
        <select
          aria-label="Status filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Status | "all")}
          className="border-border bg-background h-8 rounded-md border px-2 text-sm"
        >
          <option value="all">Everyone</option>
          <option value="overdue">Overdue ({counts.overdue})</option>
          <option value="due_today">Due today ({counts.due_today})</option>
          <option value="on_track">On track ({counts.on_track})</option>
        </select>
      </div>

      {board.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody to show.</p>
      ) : (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          data-testid="engagements-board"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.index}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute right-0 left-0 grid gap-3 pb-3 sm:grid-cols-3"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {rows[item.index]!.map((card) => (
                  <EngagementCard key={card.userId} workspaceId={workspaceId} card={card} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EngagementCard({ workspaceId, card }: { workspaceId: string; card: Card }) {
  const status = STATUS[card.status];
  return (
    <article
      className="border-border space-y-2 rounded-md border p-3 text-sm"
      data-testid={`engagement-${card.name}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{card.name}</p>
          {card.jobTitle && (
            <p className="text-muted-foreground truncate text-xs">{card.jobTitle}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}
          data-testid="engagement-status"
        >
          {status.label}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {card.openCount} open · next deadline{" "}
        <span className="text-foreground">
          {card.nextDeadline ? formatDeadline(card.nextDeadline) : "none"}
        </span>
      </p>
      {card.inProgress.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nothing in progress.</p>
      ) : (
        <ul className="space-y-0.5">
          {card.inProgress.slice(0, 4).map((t) => (
            <li key={t.id} className="flex gap-2 text-xs">
              <Link
                to="/w/$workspaceId/l/$listId"
                params={{ workspaceId, listId: t.listId }}
                search={{ openTask: t.id }}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {t.statusKind === "review" ? "⏳ " : ""}
                {t.title}
              </Link>
              {t.dueDate && (
                <span className="text-muted-foreground shrink-0">
                  {formatDue(t.dueDate, t.dueTime)}
                </span>
              )}
            </li>
          ))}
          {card.inProgress.length > 4 && (
            <li className="text-muted-foreground text-xs">+{card.inProgress.length - 4} more</li>
          )}
        </ul>
      )}
    </article>
  );
}
