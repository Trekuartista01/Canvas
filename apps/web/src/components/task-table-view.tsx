import type { AppRouter } from "@canvas/api";
import { formatDueTime, isOverdue, TASK_PRIORITIES, type TaskPriority } from "@canvas/shared";
import { Input } from "@/components/ui/input";
import { NewTaskInlineForm } from "@/components/new-task-inline-form";
import { StatusSelect } from "@/components/status-select";
import { useOptimisticTaskUpdate } from "@/hooks/use-task-mutations";
import { trpc } from "@/lib/trpc";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo, useRef, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Task = RouterOutputs["task"]["list"][number];

const ROW_HEIGHT = 40;
const COLUMNS = "grid-cols-[36px_minmax(180px,1.5fr)_140px_110px_120px_120px_28px]";

const columnHelper = createColumnHelper<Task>();

/**
 * Spreadsheet-ish table (M3.2): more columns than List, row selection, and a
 * bulk-edit toolbar. Distinct from M1.3's List view (sort/filter/group).
 */
export function TaskTableView({
  listId,
  onOpenTask,
}: {
  listId: string;
  onOpenTask: (taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const statuses = trpc.status.list.useQuery({ listId });
  const tasks = trpc.task.list.useQuery({ listId });
  const bulkUpdate = trpc.task.bulkUpdate.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate({ listId });
      setRowSelection({});
    },
  });
  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate({ listId });
      setAddingTask(false);
    },
  });

  const [sorting, setSorting] = useState<SortingState>([{ id: "title", desc: false }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkStatusId, setBulkStatusId] = useState("");
  const [bulkPriority, setBulkPriority] = useState<"" | TaskPriority | "none">("");
  const [bulkDueDate, setBulkDueDate] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  const statusList = useMemo(() => statuses.data ?? [], [statuses.data]);
  const statusOrder = useMemo(() => new Map(statusList.map((s, i) => [s.id, i])), [statusList]);
  const data = useMemo(() => tasks.data ?? [], [tasks.data]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            data-testid="table-select-all"
            aria-label="Select all"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            data-testid={`table-select-${row.original.id}`}
            aria-label={`Select ${row.original.title}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      }),
      columnHelper.accessor("title", {
        header: "Title",
        cell: (info) => (
          <InlineTitle listId={listId} task={info.row.original} onOpenTask={onOpenTask} />
        ),
      }),
      columnHelper.accessor("statusId", {
        header: "Status",
        cell: (info) => (
          <StatusSelect
            listId={listId}
            task={info.row.original}
            statuses={statusList}
            testId={`table-status-${info.row.original.id}`}
          />
        ),
        sortingFn: (a, b) =>
          (statusOrder.get(a.original.statusId) ?? 0) - (statusOrder.get(b.original.statusId) ?? 0),
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: (info) => <PriorityCell listId={listId} task={info.row.original} />,
      }),
      columnHelper.accessor("startDate", {
        header: "Start",
        cell: (info) => <DateCell listId={listId} task={info.row.original} field="startDate" />,
      }),
      columnHelper.accessor("dueDate", {
        header: "Due",
        cell: (info) => <DueCell listId={listId} task={info.row.original} />,
      }),
      columnHelper.display({
        id: "open",
        header: "",
        cell: ({ row }) => (
          <button
            type="button"
            aria-label="Open task details"
            title="Open task details"
            onClick={() => onOpenTask(row.original.id)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            ⤢
          </button>
        ),
      }),
    ],
    [listId, statusList, statusOrder, onOpenTask],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: true,
  });

  const rows = table.getRowModel().rows;
  const selectedIds = table.getSelectedRowModel().rows.map((r) => r.original.id);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  function applyBulk() {
    if (selectedIds.length === 0) return;
    const patch: {
      statusId?: string;
      priority?: TaskPriority | null;
      dueDate?: string | null;
    } = {};
    if (bulkStatusId) patch.statusId = bulkStatusId;
    if (bulkPriority === "none") patch.priority = null;
    else if (bulkPriority) patch.priority = bulkPriority;
    if (bulkDueDate) patch.dueDate = bulkDueDate;
    if (!patch.statusId && patch.priority === undefined && patch.dueDate === undefined) return;

    bulkUpdate.mutate({
      listId,
      taskIds: selectedIds,
      ...patch,
    });
  }

  if (statuses.isLoading || tasks.isLoading) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }

  return (
    <div data-testid="task-table-view" className="flex h-[calc(100vh-8rem)] flex-col p-6">
      {selectedIds.length > 0 && (
        <div
          data-testid="table-bulk-bar"
          className="border-border bg-muted/40 mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <span className="text-xs font-medium">{selectedIds.length} selected</span>
          <select
            data-testid="table-bulk-status"
            value={bulkStatusId}
            onChange={(e) => setBulkStatusId(e.target.value)}
            className="border-border bg-background h-7 rounded border text-xs"
          >
            <option value="">Status…</option>
            {statusList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            data-testid="table-bulk-priority"
            value={bulkPriority}
            onChange={(e) => setBulkPriority(e.target.value as "" | TaskPriority | "none")}
            className="border-border bg-background h-7 rounded border text-xs"
          >
            <option value="">Priority…</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="none">Clear</option>
          </select>
          <input
            type="date"
            data-testid="table-bulk-due"
            value={bulkDueDate}
            onChange={(e) => setBulkDueDate(e.target.value)}
            className="border-border bg-background h-7 rounded border text-xs"
          />
          <button
            type="button"
            data-testid="table-bulk-apply"
            disabled={bulkUpdate.isPending}
            onClick={applyBulk}
            className="bg-primary text-primary-foreground h-7 rounded px-2 text-xs disabled:opacity-50"
          >
            {bulkUpdate.isPending ? "Applying…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={() => setRowSelection({})}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="mb-2 flex items-center justify-end">
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

      <div className={`border-border grid ${COLUMNS} gap-2 border-b px-2 pb-1 text-xs font-medium`}>
        {table.getFlatHeaders().map((header) => (
          <div key={header.id} className="flex items-center">
            {header.column.getCanSort() ? (
              <button
                type="button"
                onClick={header.column.getToggleSortingHandler()}
                className="hover:text-foreground text-muted-foreground text-left"
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getIsSorted() === "asc" && " ▲"}
                {header.column.getIsSorted() === "desc" && " ▼"}
              </button>
            ) : (
              flexRender(header.column.columnDef.header, header.getContext())
            )}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                data-testid={`table-row-${row.original.id}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`border-border grid ${COLUMNS} items-center gap-2 border-b px-2 text-sm ${
                  row.getIsSelected() ? "bg-muted/30" : ""
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id} className="min-w-0 truncate">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InlineTitle({
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
      <button
        type="button"
        data-testid={`table-title-${task.id}`}
        onClick={() => {
          setValue(task.title);
          setEditing(true);
        }}
        onDoubleClick={() => onOpenTask(task.id)}
        className="hover:bg-muted w-full truncate rounded px-1 text-left"
        title="Click to edit"
      >
        {task.title}
      </button>
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

function PriorityCell({ listId, task }: { listId: string; task: Task }) {
  const update = useOptimisticTaskUpdate(listId);
  return (
    <select
      data-testid={`table-priority-${task.id}`}
      value={task.priority ?? ""}
      disabled={update.isPending}
      onChange={(e) =>
        update.mutate({
          taskId: task.id,
          priority: (e.target.value || null) as TaskPriority | null,
        })
      }
      className="border-border bg-background h-7 w-full rounded border text-xs"
    >
      <option value="">—</option>
      {TASK_PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}

function DateCell({
  listId,
  task,
  field,
}: {
  listId: string;
  task: Task;
  field: "startDate" | "dueDate";
}) {
  const update = useOptimisticTaskUpdate(listId);
  return (
    <input
      type="date"
      data-testid={`table-${field}-${task.id}`}
      value={task[field] ?? ""}
      disabled={update.isPending}
      onChange={(e) =>
        update.mutate({
          taskId: task.id,
          [field]: e.target.value || null,
        })
      }
      className="border-border bg-background h-7 w-full rounded border text-xs"
    />
  );
}

// The due column also shows the due time (M7.2) and flags overdue work —
// the time itself is edited in the task panel.
function DueCell({ listId, task }: { listId: string; task: Task }) {
  const overdue = isOverdue(
    { dueDate: task.dueDate, dueTime: task.dueTime, done: task.completedAt !== null },
    new Date(),
  );
  return (
    <div className="flex items-center gap-1">
      <DateCell listId={listId} task={task} field="dueDate" />
      {task.dueTime && (
        <span
          className={
            overdue ? "text-xs text-red-600 dark:text-red-400" : "text-muted-foreground text-xs"
          }
        >
          {formatDueTime(task.dueTime)}
        </span>
      )}
    </div>
  );
}
