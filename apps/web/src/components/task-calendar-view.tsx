import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  formatDueTime,
  monthLabel,
  taskDateKey,
} from "@canvas/shared";
import { UndatedTasksList } from "@/components/undated-tasks-list";
import { useOptimisticTaskUpdate } from "@/hooks/use-task-mutations";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";

type CalendarTask = {
  id: string;
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
};

export function TaskCalendarView({
  listId,
  onOpenTask,
}: {
  listId: string;
  onOpenTask: (taskId: string) => void;
}) {
  const tasks = trpc.task.list.useQuery({ listId });
  const update = useOptimisticTaskUpdate(listId);
  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [monthIndex, setMonthIndex] = useState(() => new Date().getMonth());

  const cells = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of tasks.data ?? []) {
      const key = taskDateKey(task);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [tasks.data]);

  const undated = useMemo(() => (tasks.data ?? []).filter((t) => !taskDateKey(t)), [tasks.data]);

  function shiftMonth(delta: number) {
    const next = new Date(year, monthIndex + delta, 1);
    setYear(next.getFullYear());
    setMonthIndex(next.getMonth());
  }

  function onDropTask(date: string, taskId: string) {
    update.mutate({ taskId, dueDate: date });
  }

  return (
    <div data-testid="task-calendar-view" className="space-y-4 px-6 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{monthLabel(year, monthIndex)}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="calendar-prev-month"
            onClick={() => shiftMonth(-1)}
            className="border-border hover:bg-muted rounded border px-2 py-1 text-xs"
          >
            Prev
          </button>
          <button
            type="button"
            data-testid="calendar-next-month"
            onClick={() => shiftMonth(1)}
            className="border-border hover:bg-muted rounded border px-2 py-1 text-xs"
          >
            Next
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-muted text-muted-foreground px-2 py-1 text-center text-[11px] font-medium"
          >
            {label}
          </div>
        ))}
        {cells.map((cell) => {
          const dayTasks = byDate.get(cell.date) ?? [];
          const isToday = cell.date === today;
          return (
            <div
              key={cell.date}
              data-testid={`calendar-day-${cell.date}`}
              data-in-month={cell.inMonth ? "true" : "false"}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const taskId = e.dataTransfer.getData("text/task-id");
                if (taskId) onDropTask(cell.date, taskId);
              }}
              className={`bg-background min-h-24 p-1 ${
                cell.inMonth ? "" : "opacity-40"
              } ${isToday ? "ring-primary ring-inset ring-1" : ""}`}
            >
              <p className="text-muted-foreground mb-1 text-[11px]">{cell.day}</p>
              <div className="space-y-0.5">
                {dayTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    draggable
                    data-testid={`calendar-task-${task.id}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/task-id", task.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onOpenTask(task.id)}
                    className="bg-muted hover:bg-muted/80 line-clamp-2 w-full rounded px-1 py-0.5 text-left text-[11px]"
                  >
                    {task.dueDate && task.dueTime && (
                      <span className="text-muted-foreground mr-1">
                        {formatDueTime(task.dueTime)}
                      </span>
                    )}
                    {task.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {undated.length > 0 && (
        <div data-testid="calendar-undated" className="space-y-2">
          <p className="text-xs font-medium">No date</p>
          <UndatedTasksList
            tasks={undated}
            onOpenTask={onOpenTask}
            draggable
            itemTestId={(taskId) => `calendar-task-${taskId}`}
          />
        </div>
      )}
    </div>
  );
}
