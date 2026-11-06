// P8.9 (docs/hr-ops-spec.md §10): Boards are spaces, their columns are lists.
// A card's list is where it sits on the board; its status is a separate field
// that keeps driving the M7.2 approval flow.

/** The lists a new board starts with. */
export const DEFAULT_BOARD_LISTS = ["To Do", "In Progress", "Review", "Done"] as const;

/** Tabs shown in the board switcher before the rest move into its dropdown. */
export const BOARD_TABS_SHOWN = 6;

/**
 * The status a card takes in another list, where each list has its own
 * statuses: the same kind if the list has one, otherwise the list's first.
 */
export function statusForMove<S extends { id: string; kind: string }>(
  targetStatuses: S[],
  kind: string,
): S | null {
  return targetStatuses.find((s) => s.kind === kind) ?? targetStatuses[0] ?? null;
}

const COLUMN_STATUS_KINDS: Record<string, string> = {
  "to do": "open",
  todo: "open",
  pending: "open",
  backlog: "open",
  "in progress": "active",
  doing: "active",
  review: "review",
  "in review": "review",
  "awaiting approval": "review",
  done: "done",
  completed: "done",
  closed: "done",
};

/** The status kind a board column stands for, from its name; null for a team's own column. */
export function columnStatusKind(name: string): string | null {
  return COLUMN_STATUS_KINDS[name.trim().toLowerCase()] ?? null;
}

/** The first column for a status kind. Closed shares the Done column. */
export function columnForStatusKind<L extends { name: string }>(
  lists: L[],
  kind: string,
): L | null {
  const wanted = kind === "closed" ? "done" : kind;
  return lists.find((l) => columnStatusKind(l.name) === wanted) ?? null;
}

/** Red on the card front: past its due date and not finished. */
export function isCardOverdue(
  card: { dueDate: string | null; statusKind: string },
  today: string,
): boolean {
  if (!card.dueDate || card.dueDate >= today) return false;
  return card.statusKind !== "done" && card.statusKind !== "closed";
}

export const BOARD_DUE_FILTERS = ["overdue", "this_week", "no_date"] as const;
export type BoardDueFilter = (typeof BOARD_DUE_FILTERS)[number];

export const BOARD_DUE_FILTER_LABELS: Record<BoardDueFilter, string> = {
  overdue: "Overdue",
  this_week: "Due in 7 days",
  no_date: "No due date",
};

export interface BoardCardFilters {
  assigneeId?: string;
  tagId?: string;
  clientId?: string;
  due?: BoardDueFilter;
}

interface FilterableCard {
  dueDate: string | null;
  statusKind: string;
  assignees: { userId: string }[];
  tags: { id: string }[];
  client?: { id: string } | null;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The cards that pass every filter that's set. */
export function filterBoardCards<C extends FilterableCard>(
  cards: C[],
  filters: BoardCardFilters,
  today: string,
): C[] {
  return cards.filter((card) => {
    if (filters.assigneeId && !card.assignees.some((a) => a.userId === filters.assigneeId)) {
      return false;
    }
    if (filters.tagId && !card.tags.some((t) => t.id === filters.tagId)) return false;
    if (filters.clientId && card.client?.id !== filters.clientId) return false;
    if (filters.due === "overdue") return isCardOverdue(card, today);
    if (filters.due === "no_date") return card.dueDate === null;
    if (filters.due === "this_week") {
      return card.dueDate !== null && card.dueDate >= today && card.dueDate <= addDaysIso(today, 7);
    }
    return true;
  });
}
