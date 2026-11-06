import type { AppRouter } from "@canvas/api";
import { Input } from "@/components/ui/input";
import { NewTaskInlineForm } from "@/components/new-task-inline-form";
import { StatusSelect } from "@/components/status-select";
import { useOptimisticTaskUpdate } from "@/hooks/use-task-mutations";
import { trpc } from "@/lib/trpc";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type GroupingState,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo, useRef, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Task = RouterOutputs["task"]["list"][number];

const ROW_HEIGHT = 36;
const COLUMNS = "grid-cols-[1fr_160px_140px]";

const columnHelper = createColumnHelper<Task>();

export function TaskListView({
  listId,
  onOpenTask,
}: {
  listId: string;
  onOpenTask: (taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const statuses = trpc.status.list.useQuery({ listId });
  const tasks = trpc.task.list.useQuery({ listId });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([{ id: "title", desc: false }]);
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [addingTask, setAddingTask] = useState(false);
  const isGroupedByStatus = grouping.includes("statusId");
  // Groups themselves always sort in workflow order; the user's chosen sort
  // (e.g. title) becomes the secondary, within-group sort. Memoized so the
  // array reference is stable across renders — TanStack Table's row-model
  // memoization keys off it, and a fresh array every render defeats that.
  const effectiveSorting = useMemo<SortingState>(
    () =>
      isGroupedByStatus
        ? [{ id: "statusId", desc: false }, ...sorting.filter((s) => s.id !== "statusId")]
        : sorting,
    [isGroupedByStatus, sorting],
  );

  const statusList = useMemo(() => statuses.data ?? [], [statuses.data]);
  const statusById = useMemo(() => new Map(statusList.map((s) => [s.id, s])), [statusList]);
  const statusOrder = useMemo(() => new Map(statusList.map((s, i) => [s.id, i])), [statusList]);

  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate({ listId });
      setAddingTask(false);
    },
  });

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tasks.data ?? []).filter((t) => {
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(t.statusId)) return false;
      return true;
    });
  }, [tasks.data, search, statusFilter]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: "Title",
        cell: (info) => (
          <EditableTitle listId={listId} task={info.row.original} onOpenTask={onOpenTask} />
        ),
      }),
      columnHelper.accessor("statusId", {
        header: "Status",
        cell: (info) => (
          <StatusSelect listId={listId} task={info.row.original} statuses={statusList} />
        ),
        sortingFn: (a, b) =>
          (statusOrder.get(a.original.statusId) ?? 0) - (statusOrder.get(b.original.statusId) ?? 0),
      }),
      columnHelper.accessor("createdAt", {
        header: "Created",
        cell: (info) => new Date(info.getValue()).toLocaleDateString(),
      }),
    ],
    [listId, statusList, statusOrder, onOpenTask],
  );

  const table = useReactTable({
    data: filteredTasks,
    columns,
    state: { sorting: effectiveSorting, grouping },
    initialState: { expanded: true },
    onSortingChange: setSorting,
    onGroupingChange: setGrouping,
    // Keep column order fixed regardless of grouping — the grid layout below
    // assigns widths by position, and grouped columns are hidden manually
    // rather than relying on TanStack's default column-reordering behavior.
    groupedColumnMode: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const rows = table.getRowModel().rows;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (statuses.isLoading || tasks.isLoading) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col p-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles…"
          className="h-8 w-56 text-sm"
        />
        <div className="flex flex-wrap gap-1">
          {statusList.map((s) => {
            const active = statusFilter.size === 0 || statusFilter.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setStatusFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  })
                }
                className={`border-border rounded-full border px-2 py-0.5 text-xs ${active ? "" : "text-muted-foreground opacity-50"}`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setGrouping(isGroupedByStatus ? [] : ["statusId"])}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          Group by status: {isGroupedByStatus ? "on" : "off"}
        </button>
        <span className="text-muted-foreground text-xs">
          {filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto">
          {addingTask ? (
            <NewTaskInlineForm
              isPending={createTask.isPending}
              onCancel={() => setAddingTask(false)}
              onSubmit={(title) =>
                statusList[0] && createTask.mutate({ listId, statusId: statusList[0].id, title })
              }
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingTask(true)}
              disabled={!statusList[0]}
              className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-50"
            >
              + Add task
            </button>
          )}
        </div>
      </div>

      {/* min-w-0 lets this flex child shrink below its content size so
          overflow-x-auto can actually kick in on a narrow (mobile) viewport
          instead of the 1fr Title column being squeezed to unreadable
          width — the inner min-w-[520px] wrappers below give the header
          and virtualized rows a shared, scrollable minimum so columns
          never collapse smaller than usable. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
        <div className="min-w-[520px]">
          <div
            className={`border-border grid ${COLUMNS} gap-2 border-b px-2 pb-1 text-xs font-medium`}
          >
            {table.getFlatHeaders().map((header) =>
              isGroupedByStatus && header.column.id === "statusId" ? (
                <span key={header.id} />
              ) : (
                <button
                  key={header.id}
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  className="hover:text-foreground text-muted-foreground flex items-center gap-1 text-left"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === "asc" && " ▲"}
                  {header.column.getIsSorted() === "desc" && " ▼"}
                </button>
              ),
            )}
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="min-w-[520px]"
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;

              const rowStyle = {
                position: "absolute" as const,
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              };

              if (row.getIsGrouped()) {
                const status = statusById.get(row.groupingValue as string);
                return (
                  <div
                    key={row.id}
                    style={{
                      ...rowStyle,
                      backgroundColor: `${status?.color ?? "#94a3b8"}12`,
                      borderLeftColor: status?.color ?? "#94a3b8",
                    }}
                    className="flex items-center gap-2 border-l-4 px-2 text-xs font-semibold"
                  >
                    <button
                      type="button"
                      onClick={row.getToggleExpandedHandler()}
                      className="w-3"
                      aria-label={row.getIsExpanded() ? "Collapse group" : "Expand group"}
                      title={row.getIsExpanded() ? "Collapse group" : "Expand group"}
                    >
                      {row.getIsExpanded() ? "▾" : "▸"}
                    </button>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: status?.color }}
                      aria-hidden
                    />
                    {status?.name ?? "—"}{" "}
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[11px]"
                      style={{
                        backgroundColor: `${status?.color ?? "#94a3b8"}26`,
                        color: status?.color,
                      }}
                    >
                      ({row.subRows.length})
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={row.id}
                  style={rowStyle}
                  className={`border-border grid ${COLUMNS} items-center gap-2 border-b px-2 text-sm`}
                >
                  {row.getVisibleCells().map((cell) =>
                    isGroupedByStatus && cell.column.id === "statusId" ? (
                      <span key={cell.id} />
                    ) : (
                      <div key={cell.id} className="truncate">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ),
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableTitle({
  listId,
  task,
  onOpenTask,
}: {
  listId: string;
  task: Task;
  onOpenTask: (taskId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.title);
  const update = useOptimisticTaskUpdate(listId);

  if (!editing) {
    return (
      <div className="group flex w-full items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setValue(task.title);
            setEditing(true);
          }}
          className="hover:bg-muted flex-1 truncate rounded px-1 text-left"
          title="Click to edit"
        >
          {task.title}
        </button>
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          aria-label="Open task details"
          title="Open task details"
          className="text-muted-foreground hover:text-foreground hidden shrink-0 text-xs group-hover:inline"
        >
          ⤢
        </button>
      </div>
    );
  }

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== task.title) {
      update.mutate({ taskId: task.id, title: trimmed });
    }
  };

  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-7 text-sm"
    />
  );
}
