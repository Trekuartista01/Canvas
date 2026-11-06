import type { AppRouter } from "@canvas/api";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { useMyAccess } from "@/hooks/use-my-access";
import { Avatar } from "@/lib/avatar";
import { trpc } from "@/lib/trpc";
import {
  BOARD_DUE_FILTERS,
  BOARD_DUE_FILTER_LABELS,
  BOARD_TABS_SHOWN,
  filterBoardCards,
  formatDmy,
  columnForStatusKind,
  columnStatusKind,
  isCardOverdue,
  todayReportDate,
  type BoardDueFilter,
} from "@canvas/shared";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { generateKeyBetween } from "fractional-indexing";
import {
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  MessageSquare,
  Paperclip,
  Plus,
  SquareKanban,
  UserPlus,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { workspaceShellRoute } from "./workspace.$workspaceId";

const searchSchema = z.object({
  board: z.string().uuid().optional(),
  card: z.string().uuid().optional(),
});

export const boardsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/boards",
  validateSearch: searchSchema,
  component: BoardsPage,
});

type Outputs = inferRouterOutputs<AppRouter>;
type Board = Outputs["task"]["board"];
type Card = Board["cards"][number];
type BoardList = Board["lists"][number];
type Space = Outputs["hierarchy"]["tree"]["spaces"][number];

const CARD_HEIGHT_ESTIMATE = 88;
const byOrderKey = (a: { orderKey: string }, b: { orderKey: string }) =>
  a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;

// P8.9 (spec §10): boards with a switcher across the top. Operations Manager,
// CEOs and Admin manage boards and their lists; everyone else works with the
// cards on boards they belong to. The server checks all of it.
function BoardsPage() {
  const { workspaceId } = boardsRoute.useParams();
  const { board: selected, card } = boardsRoute.useSearch();
  const navigate = boardsRoute.useNavigate();
  const access = useMyAccess(workspaceId);
  const canManage = access.can("boards:manageAll");
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });
  const spaces = useMemo(() => tree.data?.spaces ?? [], [tree.data]);
  const active = spaces.find((s) => s.id === selected) ?? spaces[0];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="boards-page">
      <BoardSwitcher
        workspaceId={workspaceId}
        spaces={spaces}
        activeId={active?.id}
        canManage={canManage}
        onSelect={(id) => void navigate({ search: { board: id } })}
      />
      {tree.isLoading ? (
        <p className="text-muted-foreground p-6 text-sm">Loading…</p>
      ) : !active ? (
        <p className="text-muted-foreground p-6 text-sm" data-testid="boards-empty">
          {canManage
            ? "No boards yet. Create the first one above."
            : "You aren't on any boards yet. Ask your Operations Manager to add you."}
        </p>
      ) : (
        <BoardView
          key={active.id}
          workspaceId={workspaceId}
          space={active}
          canManage={canManage}
          onOpenCard={(id) => void navigate({ search: { board: active.id, card: id } })}
        />
      )}
      {card && (
        <TaskDetailPanel
          taskId={card}
          workspaceId={workspaceId}
          onClose={() => void navigate({ search: { board: active?.id } })}
        />
      )}
    </div>
  );
}

function NameForm({
  placeholder,
  initial = "",
  submitLabel,
  isPending,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  initial?: string;
  submitLabel: string;
  isPending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <Input
        autoFocus
        value={name}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        className="h-7 w-40 text-xs"
      />
      <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={isPending}>
        {submitLabel}
      </Button>
      <button type="button" className="text-muted-foreground px-1 text-xs" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function BoardSwitcher({
  workspaceId,
  spaces,
  activeId,
  canManage,
  onSelect,
}: {
  workspaceId: string;
  spaces: Space[];
  activeId?: string;
  canManage: boolean;
  onSelect: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const create = trpc.hierarchy.space.create.useMutation({
    onSuccess: (space) => {
      void utils.hierarchy.tree.invalidate({ workspaceId });
      setAdding(false);
      onSelect(space.id);
    },
  });

  // The open board keeps its tab even when it's past the ones shown.
  const shown = spaces.slice(0, BOARD_TABS_SHOWN);
  const activeSpace = spaces.find((s) => s.id === activeId);
  if (activeSpace && !shown.includes(activeSpace)) shown[shown.length - 1] = activeSpace;
  const more = spaces.filter((s) => !shown.includes(s));

  return (
    <div
      className="border-border flex flex-wrap items-center gap-1 border-b px-4 py-2"
      data-testid="board-switcher"
    >
      <SquareKanban className="text-muted-foreground mr-1 h-4 w-4" aria-hidden />
      <div role="tablist" aria-label="Boards" className="flex flex-wrap items-center gap-1">
        {shown.map((space) => (
          <button
            key={space.id}
            type="button"
            role="tab"
            aria-selected={space.id === activeId}
            onClick={() => onSelect(space.id)}
            className={`max-w-60 truncate rounded-lg px-4 py-2 text-base font-semibold transition-opacity hover:opacity-85 ${
              space.id === activeId ? "text-white shadow-sm" : ""
            }`}
            style={
              space.id === activeId
                ? { backgroundColor: boardColor(space.id) }
                : { backgroundColor: `${boardColor(space.id)}22`, color: boardColor(space.id) }
            }
          >
            {space.name}
          </button>
        ))}
      </div>
      {more.length > 0 && (
        <select
          aria-label="More boards"
          value=""
          onChange={(e) => e.target.value && onSelect(e.target.value)}
          className="border-border bg-background h-8 rounded-md border px-2 text-xs"
        >
          <option value="">More boards ({more.length})</option>
          {more.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      )}
      {canManage &&
        (adding ? (
          <NameForm
            placeholder="Board name"
            submitLabel="Create"
            isPending={create.isPending}
            onCancel={() => setAdding(false)}
            onSubmit={(name) => create.mutate({ workspaceId, name })}
          />
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)} data-testid="new-board">
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            New board
          </Button>
        ))}
      {create.error && (
        <span className="text-xs text-red-600 dark:text-red-400" role="alert">
          {create.error.message}
        </span>
      )}
    </div>
  );
}

/** Each board keeps one colour, picked from its id. All are readable with white text. */
const BOARD_COLORS = ["#2563eb", "#7c3aed", "#c2410c", "#0f766e", "#be123c", "#4d7c0f", "#a21caf"];

function boardColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return BOARD_COLORS[hash % BOARD_COLORS.length]!;
}

function BoardView({
  workspaceId,
  space,
  canManage,
  onOpenCard,
}: {
  workspaceId: string;
  space: Space;
  canManage: boolean;
  onOpenCard: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const input = { spaceId: space.id };
  const board = trpc.task.board.useQuery(input);
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const tags = trpc.tag.list.useQuery({ workspaceId });
  const [assigneeId, setAssigneeId] = useState("");
  const [tagId, setTagId] = useState("");
  const [clientId, setClientId] = useState("");
  const [due, setDue] = useState<BoardDueFilter | "">("");
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [addingList, setAddingList] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const today = todayReportDate(new Date());

  const invalidate = () => {
    void utils.task.board.invalidate(input);
    void utils.hierarchy.tree.invalidate({ workspaceId });
  };

  // Optimistic: the card lands straight away and goes back if the server says no.
  const move = trpc.task.update.useMutation({
    onMutate: async (vars) => {
      await utils.task.board.cancel(input);
      const previous = utils.task.board.getData(input);
      utils.task.board.setData(input, (old) =>
        old
          ? {
              ...old,
              cards: old.cards.map((c) =>
                c.id === vars.taskId
                  ? {
                      ...c,
                      listId: vars.listId ?? c.listId,
                      orderKey: vars.orderKey ?? c.orderKey,
                    }
                  : c,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) utils.task.board.setData(input, context.previous);
    },
    onSettled: () => utils.task.board.invalidate(input),
  });
  const createList = trpc.hierarchy.list.create.useMutation({
    onSuccess: () => {
      invalidate();
      setAddingList(false);
    },
  });
  const restoreList = trpc.hierarchy.list.setArchived.useMutation({ onSuccess: invalidate });
  const renameBoard = trpc.hierarchy.space.update.useMutation({
    onSuccess: () => {
      invalidate();
      setRenaming(false);
    },
  });
  const archiveBoard = trpc.hierarchy.space.delete.useMutation({ onSuccess: invalidate });

  const lists = board.data?.lists ?? [];
  const cards = useMemo(() => {
    const visible = filterBoardCards(
      board.data?.cards ?? [],
      {
        assigneeId: assigneeId || undefined,
        tagId: tagId || undefined,
        clientId: clientId || undefined,
        due: due || undefined,
      },
      today,
    );
    return [...visible].sort(byOrderKey);
  }, [board.data, assigneeId, tagId, clientId, due, today]);

  // Only clients already on this board's cards: the full list is Ops-only.
  const boardClients = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of board.data?.cards ?? []) {
      if (c.client) byId.set(c.client.id, c.client.name);
    }
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [board.data]);

  const cardsByList = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const c of cards) map.set(c.listId, [...(map.get(c.listId) ?? []), c]);
    return map;
  }, [cards]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart(event: DragStartEvent) {
    setActiveCard(cards.find((c) => c.id === event.active.id) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const dragged = cards.find((c) => c.id === active.id);
    if (!dragged) return;

    const overCard = cards.find((c) => c.id === over.id);
    const targetListId = overCard ? overCard.listId : String(over.id);
    if (!lists.some((l) => l.id === targetListId)) return;

    const rest = (cardsByList.get(targetListId) ?? []).filter((c) => c.id !== dragged.id);
    let index = overCard ? rest.findIndex((c) => c.id === overCard.id) : rest.length;
    if (index === -1) index = rest.length;
    // Dropping lower in the same list lands after the card it was dropped on.
    const sameList = targetListId === dragged.listId;
    if (sameList && overCard && dragged.orderKey < overCard.orderKey) index += 1;
    const orderKey = generateKeyBetween(
      rest[index - 1]?.orderKey ?? null,
      rest[index]?.orderKey ?? null,
    );
    move.mutate({
      taskId: dragged.id,
      orderKey,
      ...(sameList ? {} : { listId: targetListId }),
    });
  }

  if (board.isLoading) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  if (board.error) {
    return (
      <p className="p-6 text-sm text-red-600 dark:text-red-400" role="alert">
        {board.error.message}
      </p>
    );
  }

  const filtered = Boolean(assigneeId || tagId || clientId || due);
  // The To Do column, or the first one on a board without one.
  const addTaskListId = (columnForStatusKind(lists, "open") ?? lists[0])?.id;
  const archived = board.data?.archivedLists ?? [];

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs"
        data-testid="board-toolbar"
      >
        <select
          aria-label="Filter by assignee"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="border-border bg-background h-7 rounded border px-1"
        >
          <option value="">All assignees</option>
          {(members.data ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by label"
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          className="border-border bg-background h-7 rounded border px-1"
        >
          <option value="">All labels</option>
          {(tags.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="border-border bg-background h-7 rounded border px-1"
        >
          <option value="">All clients</option>
          {boardClients.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by due date"
          value={due}
          onChange={(e) => setDue(e.target.value as BoardDueFilter | "")}
          className="border-border bg-background h-7 rounded border px-1"
        >
          <option value="">Any due date</option>
          {BOARD_DUE_FILTERS.map((f) => (
            <option key={f} value={f}>
              {BOARD_DUE_FILTER_LABELS[f]}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            type="button"
            className="text-muted-foreground underline"
            onClick={() => {
              setAssigneeId("");
              setTagId("");
              setClientId("");
              setDue("");
            }}
          >
            Clear filters
          </button>
        )}
        {canManage && (
          <span className="ml-auto flex flex-wrap items-center gap-3">
            {renaming ? (
              <NameForm
                placeholder="Board name"
                initial={space.name}
                submitLabel="Save"
                isPending={renameBoard.isPending}
                onCancel={() => setRenaming(false)}
                onSubmit={(name) => renameBoard.mutate({ spaceId: space.id, name })}
              />
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setRenaming(true)}
              >
                Rename board
              </button>
            )}
            <BoardPeopleButton spaceId={space.id} onOpen={() => setShowMembers(true)} />
            {confirmingArchive ? (
              <>
                <span>Archive this board and its cards?</span>
                <button
                  type="button"
                  className="font-medium text-red-600 dark:text-red-400"
                  disabled={archiveBoard.isPending}
                  onClick={() => archiveBoard.mutate({ spaceId: space.id })}
                >
                  Yes, archive
                </button>
                <button type="button" onClick={() => setConfirmingArchive(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-red-600"
                onClick={() => setConfirmingArchive(true)}
              >
                Archive board
              </button>
            )}
          </span>
        )}
      </div>
      {move.error && (
        <p className="px-4 text-xs text-red-600 dark:text-red-400" role="alert">
          {move.error.message}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div
          className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-4"
          data-testid="board-lists"
        >
          {lists.map((list, i) => (
            <ListColumn
              key={list.id}
              workspaceId={workspaceId}
              spaceId={space.id}
              list={list}
              previous={lists[i - 1]}
              beforePrevious={lists[i - 2]}
              next={lists[i + 1]}
              afterNext={lists[i + 2]}
              cards={cardsByList.get(list.id) ?? []}
              today={today}
              canManage={canManage}
              canAddTask={list.id === addTaskListId}
              onChanged={invalidate}
              onOpenCard={onOpenCard}
            />
          ))}
          {canManage && (
            <div className="w-64 shrink-0 space-y-2 pt-1">
              {addingList ? (
                <NameForm
                  placeholder="List name"
                  submitLabel="Add"
                  isPending={createList.isPending}
                  onCancel={() => setAddingList(false)}
                  onSubmit={(name) => createList.mutate({ spaceId: space.id, name })}
                />
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-sm"
                  onClick={() => setAddingList(true)}
                  data-testid="add-list"
                >
                  + Add a list
                </button>
              )}
              {archived.length > 0 && (
                <div className="text-xs" data-testid="archived-lists">
                  <p className="text-muted-foreground mb-1">Archived lists</p>
                  <ul className="space-y-1">
                    {archived.map((l) => (
                      <li key={l.id} className="flex items-center gap-2">
                        <span className="truncate">{l.name}</span>
                        <button
                          type="button"
                          className="text-accent ml-auto"
                          aria-label={`Restore ${l.name}`}
                          onClick={() => restoreList.mutate({ listId: l.id, archived: false })}
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <DragOverlay>
          {activeCard ? (
            <div className="border-border bg-background w-60 rounded-md border p-2 text-sm shadow-lg">
              {activeCard.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {showMembers && (
        <BoardMembers
          workspaceId={workspaceId}
          space={space}
          onClose={() => setShowMembers(false)}
        />
      )}
    </>
  );
}

function ListColumn({
  workspaceId,
  spaceId,
  list,
  previous,
  beforePrevious,
  next,
  afterNext,
  cards,
  today,
  canManage,
  onChanged,
  canAddTask,
  onOpenCard,
}: {
  workspaceId: string;
  spaceId: string;
  list: BoardList;
  previous?: BoardList;
  beforePrevious?: BoardList;
  next?: BoardList;
  afterNext?: BoardList;
  cards: Card[];
  today: string;
  canManage: boolean;
  /** New tasks start in one place: the To Do column. */
  canAddTask: boolean;
  onChanged: () => void;
  onOpenCard: (id: string) => void;
}) {
  const [addingCard, setAddingCard] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, isOver } = useDroppable({ id: list.id });
  const setScrollNode = (node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setNodeRef(node);
  };
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT_ESTIMATE,
    overscan: 8,
  });

  const createCard = trpc.task.create.useMutation({
    onSuccess: () => {
      onChanged();
      setAddingCard(false);
    },
  });
  const update = trpc.hierarchy.list.update.useMutation({
    onSuccess: () => {
      onChanged();
      setRenaming(false);
    },
  });
  const archive = trpc.hierarchy.list.setArchived.useMutation({ onSuccess: onChanged });

  const moveLeft = () =>
    previous &&
    update.mutate({
      listId: list.id,
      orderKey: generateKeyBetween(beforePrevious?.orderKey ?? null, previous.orderKey),
    });
  const moveRight = () =>
    next &&
    update.mutate({
      listId: list.id,
      orderKey: generateKeyBetween(next.orderKey, afterNext?.orderKey ?? null),
    });

  return (
    <section
      className={`bg-muted/70 flex max-h-full w-72 shrink-0 flex-col gap-2 rounded-xl border-t-4 p-2.5 ${
        isOver ? "ring-accent ring-2" : ""
      }`}
      style={{ borderTopColor: COLUMN_COLOR[columnStatusKind(list.name) ?? ""] ?? "var(--border)" }}
      aria-label={`List ${list.name}`}
      data-testid={`board-list-${list.name}`}
    >
      {renaming ? (
        <NameForm
          placeholder="List name"
          initial={list.name}
          submitLabel="Save"
          isPending={update.isPending}
          onCancel={() => setRenaming(false)}
          onSubmit={(name) => update.mutate({ listId: list.id, name })}
        />
      ) : (
        <header className="group flex items-center gap-1">
          <Link
            to="/w/$workspaceId/l/$listId"
            params={{ workspaceId, listId: list.id }}
            title={`Open ${list.name} as a list, calendar, table or timeline`}
            className="mr-auto min-w-0 truncate rounded-md px-2 py-0.5 text-base font-bold hover:underline"
            style={
              COLUMN_COLOR[columnStatusKind(list.name) ?? ""]
                ? { backgroundColor: `${COLUMN_COLOR[columnStatusKind(list.name) ?? ""]}2e` }
                : undefined
            }
          >
            {list.name}
          </Link>
          <span
            className="bg-background text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium"
            data-testid="board-list-count"
          >
            {cards.length}
          </span>
          {canManage && (
            <span className="flex items-center gap-1 text-xs transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:opacity-0">
              <button
                type="button"
                aria-label={`Move ${list.name} left`}
                disabled={!previous}
                onClick={moveLeft}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Move ${list.name} right`}
                disabled={!next}
                onClick={moveRight}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Rename ${list.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
              <button
                type="button"
                aria-label={`Archive ${list.name}`}
                className="text-muted-foreground hover:text-red-600"
                onClick={() => archive.mutate({ listId: list.id, archived: true })}
              >
                Archive
              </button>
            </span>
          )}
        </header>
      )}
      {(update.error ?? archive.error ?? createCard.error) && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {(update.error ?? archive.error ?? createCard.error)?.message}
        </p>
      )}

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setScrollNode} className="min-h-10 flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const card = cards[item.index];
              if (!card) return null;
              return (
                <div
                  key={card.id}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <CardFront card={card} today={today} onOpen={() => onOpenCard(card.id)} />
                </div>
              );
            })}
          </div>
        </div>
      </SortableContext>

      {canAddTask &&
        (addingCard ? (
          <AddTaskForm
            workspaceId={workspaceId}
            isPending={createCard.isPending}
            error={createCard.error?.message}
            onCancel={() => setAddingCard(false)}
            onSubmit={(title, assigneeId) =>
              createCard.mutate({
                listId: list.id,
                title,
                ...(assigneeId ? { assigneeIds: [assigneeId] } : {}),
              })
            }
          />
        ) : (
          <Button
            size="lg"
            className="w-full shrink-0 px-4 text-sm"
            onClick={() => setAddingCard(true)}
            data-testid="add-task"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add a task
          </Button>
        ))}
    </section>
  );
}

function AddTaskForm({
  workspaceId,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  workspaceId: string;
  isPending: boolean;
  error?: string;
  onSubmit: (title: string, assigneeId: string) => void;
  onCancel: () => void;
}) {
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  return (
    <form
      className="border-border bg-card shrink-0 space-y-2 rounded-lg border p-3 shadow-sm"
      data-testid="add-task-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSubmit(title.trim(), assigneeId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <Input
        autoFocus
        value={title}
        placeholder="Task title"
        aria-label="Task title"
        onChange={(e) => setTitle(e.target.value)}
        className="h-10 text-sm"
      />
      <select
        aria-label="Assign to"
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
        className="border-border bg-background h-10 w-full rounded-md border px-2 text-sm"
      >
        <option value="">Assign to…</option>
        {(members.data ?? []).map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={isPending || !title.trim()}>
          Add task
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A column's colour comes from the status it stands for. */
const COLUMN_COLOR: Record<string, string> = {
  open: "#94a3b8",
  active: "#3b82f6",
  review: "#f59e0b",
  done: "#22c55e",
};

function CardFront({ card, today, onOpen }: { card: Card; today: string; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });
  const overdue = isCardOverdue(card, today);
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
      className="border-border bg-card cursor-grab touch-none space-y-2 rounded-lg border p-3 text-sm shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
      data-testid={`board-card-${card.title}`}
    >
      {card.client && (
        <span
          className="inline-block max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: `${card.client.color}26`, color: card.client.color }}
          data-testid="card-client-front"
        >
          {card.client.name}
        </span>
      )}
      {card.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {card.tags.map((tag) => (
            <li
              key={tag.id}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: `${tag.color}26`, color: tag.color }}
            >
              {tag.name}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onOpen}
        onPointerDown={(e) => e.stopPropagation()}
        className="block w-full text-left font-medium break-words"
      >
        {card.title}
      </button>
      {(card.dueDate ||
        card.checklistTotal > 0 ||
        card.comments > 0 ||
        card.attachments > 0 ||
        card.assignees.length > 0) && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          {card.dueDate && (
            <span
              className={overdue ? "font-medium text-red-600 dark:text-red-400" : ""}
              data-testid="card-due"
              data-overdue={overdue}
            >
              {formatDmy(card.dueDate)}
            </span>
          )}
          {card.checklistTotal > 0 && (
            <span className="flex items-center gap-0.5" data-testid="card-checklist">
              <CheckSquare className="h-3 w-3" aria-hidden />
              {card.checklistDone}/{card.checklistTotal}
            </span>
          )}
          {card.comments > 0 && (
            <span className="flex items-center gap-0.5" data-testid="card-comments">
              <MessageSquare className="h-3 w-3" aria-hidden />
              {card.comments}
            </span>
          )}
          {card.attachments > 0 && (
            <span className="flex items-center gap-0.5" data-testid="card-attachments">
              <Paperclip className="h-3 w-3" aria-hidden />
              {card.attachments}
            </span>
          )}
          {card.assignees.length > 0 && (
            <ul className="ml-auto flex -space-x-1" data-testid="card-assignees">
              {card.assignees.map((a) => (
                <li key={a.userId} title={a.name}>
                  {a.avatarUrl ? (
                    <img
                      src={a.avatarUrl}
                      alt={a.name}
                      className="border-background h-5 w-5 rounded-full border object-cover"
                    />
                  ) : (
                    <span
                      aria-label={a.name}
                      className="bg-muted border-background text-foreground flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-semibold"
                    >
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

/** Who's on this board at a glance, and the way to add someone. */
function BoardPeopleButton({ spaceId, onOpen }: { spaceId: string; onOpen: () => void }) {
  const onBoard = trpc.hierarchy.members.list.useQuery({ spaceId });
  const people = onBoard.data ?? [];
  return (
    <span className="flex items-center gap-2">
      {people.length > 0 && (
        <span className="flex -space-x-1.5" aria-hidden>
          {people.slice(0, 5).map((m) => (
            <Avatar
              key={m.userId}
              name={m.name}
              avatarUrl={m.avatarUrl}
              className="ring-background h-6 w-6 text-[11px] ring-2"
            />
          ))}
        </span>
      )}
      <Button size="sm" onClick={onOpen} data-testid="board-members-open">
        <UserPlus className="h-4 w-4" aria-hidden />
        Add people
      </Button>
    </span>
  );
}

function BoardMembers({
  workspaceId,
  space,
  onClose,
}: {
  workspaceId: string;
  space: Space;
  onClose: () => void;
}) {
  const { containerRef, onKeyDown } = useModalA11y(onClose);
  const utils = trpc.useUtils();
  const input = { spaceId: space.id };
  const onBoard = trpc.hierarchy.members.list.useQuery(input);
  const everyone = trpc.workspace.members.useQuery({ workspaceId });
  const invalidate = () => utils.hierarchy.members.list.invalidate(input);
  const add = trpc.hierarchy.members.add.useMutation({ onSuccess: invalidate });
  const remove = trpc.hierarchy.members.remove.useMutation({ onSuccess: invalidate });
  const [search, setSearch] = useState("");
  const ids = new Set((onBoard.data ?? []).map((m) => m.userId));
  const q = search.trim().toLowerCase();
  const others = (everyone.data ?? []).filter(
    (m) =>
      !ids.has(m.userId) &&
      (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
  );
  const error = add.error ?? remove.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={`People on ${space.name}`}
        tabIndex={-1}
        data-testid="board-members"
        className="border-border bg-card flex max-h-[85vh] w-full max-w-md flex-col gap-4 rounded-xl border p-5 shadow-xl outline-none"
      >
        <div className="flex items-center">
          <h2 className="mr-auto text-lg font-bold tracking-tight">People on {space.name}</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {error.message}
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <Input
            autoFocus
            value={search}
            placeholder="Search everyone in the workspace"
            aria-label="Search people to add"
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm"
          />
          <ul className="max-h-56 min-h-0 overflow-y-auto" data-testid="board-people-to-add">
            {others.map((m) => (
              <li key={m.userId} className="flex items-center gap-2.5 py-1.5 text-sm">
                <Avatar name={m.name} avatarUrl={m.avatarUrl} className="h-7 w-7" />
                <span className="mr-auto min-w-0 truncate font-medium">{m.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Add ${m.name}`}
                  disabled={add.isPending}
                  onClick={() => add.mutate({ spaceId: space.id, userId: m.userId })}
                >
                  Add
                </Button>
              </li>
            ))}
            {others.length === 0 && (
              <li className="text-muted-foreground py-2 text-sm">
                {q ? "Nobody matches." : "Everyone is already on this board."}
              </li>
            )}
          </ul>
        </div>

        <div className="border-border flex min-h-0 flex-col gap-1 border-t pt-3">
          <h3 className="text-sm font-semibold">On this board ({onBoard.data?.length ?? 0})</h3>
          <ul className="max-h-44 min-h-0 overflow-y-auto text-sm">
            {(onBoard.data ?? []).map((m) => (
              <li key={m.userId} className="flex items-center gap-2.5 py-1.5">
                <Avatar name={m.name} avatarUrl={m.avatarUrl} className="h-7 w-7" />
                <span className="mr-auto min-w-0 truncate">{m.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  className="text-muted-foreground text-xs hover:text-red-600"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ spaceId: space.id, userId: m.userId })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            Operations Manager, CEOs and Admin reach every board. Everyone else sees only the boards
            they&apos;re on.
          </p>
        </div>
      </div>
    </div>
  );
}
