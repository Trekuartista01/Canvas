import type { AppRouter } from "@canvas/api";
import { STATUS_KINDS } from "@canvas/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewTaskInlineForm } from "@/components/new-task-inline-form";
import { StatusSelect } from "@/components/status-select";
import { useOptimisticTaskUpdate } from "@/hooks/use-task-mutations";
import { trpc } from "@/lib/trpc";
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
import type { inferRouterOutputs } from "@trpc/server";
import { generateKeyBetween } from "fractional-indexing";
import { useMemo, useRef, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Status = RouterOutputs["status"]["list"][number];
type Task = RouterOutputs["task"]["list"][number];

const STATUS_PALETTE = ["#94a3b8", "#3b82f6", "#a855f7", "#f59e0b", "#22c55e", "#ef4444"];
// Task cards vary in height (a wrapping title, an open delete-confirm row),
// so the virtualizer measures real heights via `measureElement` — this is
// only the seed used before a card's first real measurement lands.
const CARD_HEIGHT_ESTIMATE = 68;

export function TaskBoard({
  listId,
  onOpenTask,
}: {
  listId: string;
  onOpenTask: (taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const statuses = trpc.status.list.useQuery({ listId });
  const tasks = trpc.task.list.useQuery({ listId });
  const [addingStatus, setAddingStatus] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const update = useOptimisticTaskUpdate(listId);
  const invalidateStatuses = () => utils.status.list.invalidate({ listId });
  const invalidateTasks = () => utils.task.list.invalidate({ listId });

  const createStatus = trpc.status.create.useMutation({
    onSuccess: () => {
      invalidateStatuses();
      setAddingStatus(false);
    },
  });

  const statusList = useMemo(() => statuses.data ?? [], [statuses.data]);
  const taskList = useMemo(() => tasks.data ?? [], [tasks.data]);

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const s of statusList) map.set(s.id, []);
    for (const t of taskList) map.get(t.statusId)?.push(t);
    for (const list of map.values()) {
      list.sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
    }
    return map;
  }, [statusList, taskList]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(taskList.find((t) => t.id === event.active.id) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedTask = taskList.find((t) => t.id === active.id);
    if (!draggedTask) return;

    const overTask = taskList.find((t) => t.id === over.id);
    const targetStatusId = overTask ? overTask.statusId : String(over.id);
    const targetTasks = tasksByStatus.get(targetStatusId);
    if (!targetTasks) return; // dropped somewhere that isn't a status column

    const withoutDragged = targetTasks.filter((t) => t.id !== draggedTask.id);
    let overIndex = overTask
      ? withoutDragged.findIndex((t) => t.id === overTask.id)
      : withoutDragged.length;
    if (overIndex === -1) overIndex = withoutDragged.length;

    const prev = withoutDragged[overIndex - 1];
    const next = withoutDragged[overIndex];
    const orderKey = generateKeyBetween(prev?.orderKey ?? null, next?.orderKey ?? null);

    if (targetStatusId === draggedTask.statusId && orderKey === draggedTask.orderKey) return;

    update.mutate({
      taskId: draggedTask.id,
      orderKey,
      ...(targetStatusId !== draggedTask.statusId ? { statusId: targetStatusId } : {}),
    });
  }

  if (statuses.isLoading || tasks.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex items-start gap-4 overflow-x-auto p-6">
        {statusList.map((status) => (
          <StatusColumn
            key={status.id}
            listId={listId}
            status={status}
            statuses={statusList}
            tasks={tasksByStatus.get(status.id) ?? []}
            onTasksChanged={invalidateTasks}
            onStatusesChanged={invalidateStatuses}
            onOpenTask={onOpenTask}
          />
        ))}

        <div className="w-64 shrink-0">
          {addingStatus ? (
            <NewStatusForm
              isPending={createStatus.isPending}
              onCancel={() => setAddingStatus(false)}
              onSubmit={(name, kind) =>
                createStatus.mutate({
                  listId,
                  name,
                  kind,
                  color: STATUS_PALETTE[statusList.length % STATUS_PALETTE.length] ?? "#94a3b8",
                })
              }
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingStatus(true)}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              + Add status
            </button>
          )}
        </div>
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="border-border bg-background w-64 rounded-md border p-2 text-sm shadow-lg">
            {activeTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function StatusColumn({
  listId,
  status,
  statuses,
  tasks,
  onTasksChanged,
  onStatusesChanged,
  onOpenTask,
}: {
  listId: string;
  status: Status;
  statuses: Status[];
  tasks: Task[];
  onTasksChanged: () => void;
  onStatusesChanged: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [addingTask, setAddingTask] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  // Both the virtualizer and dnd-kit's droppable need a ref to the same
  // scrollable element — dnd-kit's own autoscroll-during-drag also keys off
  // this being the nearest scrollable ancestor of the dragged item.
  const setScrollNode = (node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setNodeRef(node);
  };
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT_ESTIMATE,
    overscan: 8,
  });

  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      onTasksChanged();
      setAddingTask(false);
    },
  });
  const deleteStatus = trpc.status.delete.useMutation({
    onSuccess: onStatusesChanged,
    onError: (err) => setDeleteError(err.message),
  });

  return (
    <div
      className={`w-64 shrink-0 space-y-2 rounded-md p-1 ${isOver ? "bg-muted/50" : ""}`}
      data-testid={`status-column-${status.name}`}
    >
      <div
        className="group flex items-center gap-2 rounded-md border-l-4 px-2 py-1.5"
        style={{ borderLeftColor: status.color, backgroundColor: `${status.color}12` }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: status.color }}
          aria-hidden
        />
        <span className="flex-1 truncate text-sm font-semibold">{status.name}</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: `${status.color}26`, color: status.color }}
        >
          {tasks.length}
        </span>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          aria-label="Delete status"
          title="Delete status"
          className="text-muted-foreground hover:text-foreground hidden text-xs group-hover:inline"
        >
          ✕
        </button>
      </div>

      {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
      {confirmingDelete && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Delete "{status.name}"?</span>
          <button
            type="button"
            className="text-red-500"
            disabled={deleteStatus.isPending}
            onClick={() => deleteStatus.mutate({ statusId: status.id })}
          >
            Delete
          </button>
          <button
            type="button"
            className="text-muted-foreground"
            onClick={() => {
              setConfirmingDelete(false);
              setDeleteError(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setScrollNode} className="min-h-8 max-h-[calc(100vh-16rem)] overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const task = tasks[virtualItem.index];
              if (!task) return null;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className="pb-1"
                >
                  <TaskRow
                    listId={listId}
                    statuses={statuses}
                    task={task}
                    onChanged={onTasksChanged}
                    onOpenTask={onOpenTask}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </SortableContext>

      {addingTask ? (
        <NewTaskInlineForm
          isPending={createTask.isPending}
          onCancel={() => setAddingTask(false)}
          onSubmit={(title) => createTask.mutate({ listId, statusId: status.id, title })}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingTask(true)}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          + Add task
        </button>
      )}
    </div>
  );
}

function TaskRow({
  listId,
  task,
  statuses,
  onChanged,
  onOpenTask,
}: {
  listId: string;
  task: Task;
  statuses: Status[];
  onChanged: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const del = trpc.task.delete.useMutation({ onSuccess: onChanged });

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group border-border bg-background rounded-md border p-2"
      data-testid={`task-card-${task.title}`}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          className="text-muted-foreground touch-none cursor-grab px-0.5 active:cursor-grabbing"
        >
          ⠿
        </button>
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="flex-1 truncate text-left text-sm"
        >
          {task.title}
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          aria-label="Delete task"
          title="Delete task"
          className="text-muted-foreground hover:text-foreground hidden text-xs group-hover:inline"
        >
          ✕
        </button>
      </div>
      <div className="mt-1.5">
        <StatusSelect listId={listId} task={task} statuses={statuses} />
      </div>
      {confirmingDelete && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Delete task?</span>
          <button
            type="button"
            className="text-red-500"
            disabled={del.isPending}
            onClick={() => del.mutate({ taskId: task.id })}
          >
            Delete
          </button>
          <button
            type="button"
            className="text-muted-foreground"
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function NewStatusForm({
  isPending,
  onSubmit,
  onCancel,
}: {
  isPending: boolean;
  onSubmit: (name: string, kind: (typeof STATUS_KINDS)[number]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof STATUS_KINDS)[number]>("open");
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim(), kind);
      }}
    >
      <Input
        autoFocus
        value={name}
        placeholder="Status name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        className="h-7 text-xs"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as (typeof STATUS_KINDS)[number])}
        className="border-border bg-background h-7 w-full rounded border text-xs"
      >
        {STATUS_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <Button
        type="submit"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={isPending || !name.trim()}
      >
        Add status
      </Button>
    </form>
  );
}
