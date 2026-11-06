import type { AppRouter } from "@canvas/api";
import {
  TASK_DEPENDENCY_KINDS,
  buildGanttDays,
  buildGanttRange,
  ganttBarOffset,
  taskDateSpan,
  type TaskDependencyKind,
} from "@canvas/shared";
import { UndatedTasksList } from "@/components/undated-tasks-list";
import { trpc } from "@/lib/trpc";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo, useRef, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Task = RouterOutputs["task"]["list"][number];
type Dependency = RouterOutputs["task"]["dependencies"]["list"][number];

const DAY_WIDTH = 32;
const ROW_HEIGHT = 36;
const LABEL_WIDTH = 220;

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * M3.3: a horizontal timeline (one column per day) with a bar per dated
 * task, plus SVG dependency arrows. Distinct from Calendar (M3.1, a month
 * grid keyed by a single date) — this is a range view keyed by start→due.
 */
export function TaskGanttView({
  listId,
  onOpenTask,
}: {
  listId: string;
  onOpenTask: (taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const tasks = trpc.task.list.useQuery({ listId });
  const dependencies = trpc.task.dependencies.list.useQuery({ listId });

  const [depTaskId, setDepTaskId] = useState("");
  const [depOnTaskId, setDepOnTaskId] = useState("");
  const [depKind, setDepKind] = useState<TaskDependencyKind>("blocks");
  const [depError, setDepError] = useState<string | null>(null);

  const addDependency = trpc.task.dependencies.add.useMutation({
    onSuccess: () => {
      void utils.task.dependencies.list.invalidate({ listId });
      setDepTaskId("");
      setDepOnTaskId("");
      setDepError(null);
    },
    onError: (err) => setDepError(err.message),
  });
  const removeDependency = trpc.task.dependencies.remove.useMutation({
    onSuccess: () => void utils.task.dependencies.list.invalidate({ listId }),
  });

  const allTasks = useMemo(() => tasks.data ?? [], [tasks.data]);
  const rows = useMemo(
    () =>
      allTasks
        .map((task) => ({ task, span: taskDateSpan(task) }))
        .filter(
          (row): row is { task: Task; span: NonNullable<ReturnType<typeof taskDateSpan>> } =>
            row.span !== null,
        )
        .map((row) => ({
          ...row,
          // A milestone renders as a single point (diamond), not a bar
          // spanning start→due, even if both happen to be set — anchor on
          // due (falling back to start) rather than the full span.
          barSpan: row.task.isMilestone
            ? {
                start: row.task.dueDate ?? row.task.startDate ?? row.span.start,
                end: row.task.dueDate ?? row.task.startDate ?? row.span.start,
              }
            : row.span,
        }))
        .sort((a, b) =>
          a.barSpan.start < b.barSpan.start ? -1 : a.barSpan.start > b.barSpan.start ? 1 : 0,
        ),
    [allTasks],
  );
  const undated = useMemo(() => allTasks.filter((t) => taskDateSpan(t) === null), [allTasks]);

  const range = useMemo(
    () =>
      buildGanttRange(
        rows.map((r) => r.barSpan),
        today(),
      ),
    [rows],
  );
  const days = useMemo(() => buildGanttDays(range), [range]);
  const rowIndexByTaskId = useMemo(() => new Map(rows.map((r, i) => [r.task.id, i])), [rows]);

  // Row labels and bars share one vertical scroller (below) so both axes of
  // the grid stay virtualized together — only dependency arrows (bounded by
  // edge count, not task count) still render for every row unconditionally.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const visibleDeps = useMemo(
    () =>
      (dependencies.data ?? []).filter(
        (d: Dependency) =>
          rowIndexByTaskId.has(d.taskId) && rowIndexByTaskId.has(d.dependsOnTaskId),
      ),
    [dependencies.data, rowIndexByTaskId],
  );

  function addDependencyRow() {
    setDepError(null);
    if (!depTaskId || !depOnTaskId) return;
    if (depTaskId === depOnTaskId) {
      setDepError("A task cannot depend on itself");
      return;
    }
    addDependency.mutate({ taskId: depTaskId, dependsOnTaskId: depOnTaskId, kind: depKind });
  }

  if (tasks.isLoading || dependencies.isLoading) {
    return <p className="text-muted-foreground p-8 text-sm">Loading…</p>;
  }

  const gridWidth = days.length * DAY_WIDTH;
  const gridHeight = Math.max(rows.length, 1) * ROW_HEIGHT;
  const todayOffset = days.findIndex((d) => d.date === today());

  return (
    <div data-testid="task-gantt-view" className="space-y-4 px-6 py-4">
      <div className="border-border bg-muted/40 flex flex-wrap items-end gap-2 rounded-md border px-3 py-2 text-sm">
        <label className="flex flex-col gap-1 text-xs">
          Task
          <select
            data-testid="gantt-dep-task"
            value={depTaskId}
            onChange={(e) => setDepTaskId(e.target.value)}
            className="border-border bg-background h-7 rounded border text-xs"
          >
            <option value="">Select…</option>
            {allTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Depends on
          <select
            data-testid="gantt-dep-on-task"
            value={depOnTaskId}
            onChange={(e) => setDepOnTaskId(e.target.value)}
            className="border-border bg-background h-7 rounded border text-xs"
          >
            <option value="">Select…</option>
            {allTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Kind
          <select
            data-testid="gantt-dep-kind"
            value={depKind}
            onChange={(e) => setDepKind(e.target.value as TaskDependencyKind)}
            className="border-border bg-background h-7 rounded border text-xs"
          >
            {TASK_DEPENDENCY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="gantt-dep-add"
          disabled={addDependency.isPending}
          onClick={addDependencyRow}
          className="bg-primary text-primary-foreground h-7 rounded px-2 text-xs disabled:opacity-50"
        >
          Add dependency
        </button>
        {depError && (
          <p data-testid="gantt-dep-error" className="text-destructive w-full text-xs">
            {depError}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No dated tasks yet — set a start or due date to place a task on the timeline.
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="border-border flex max-h-[calc(100vh-22rem)] overflow-x-hidden overflow-y-auto rounded-md border"
        >
          <div style={{ width: LABEL_WIDTH }} className="shrink-0">
            <div
              style={{ height: 28 }}
              className="border-border bg-muted sticky top-0 z-10 border-b"
            />
            <div style={{ height: gridHeight, position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                return (
                  <button
                    key={row.task.id}
                    type="button"
                    data-testid={`gantt-row-label-${row.task.id}`}
                    onClick={() => onOpenTask(row.task.id)}
                    style={{
                      position: "absolute",
                      top: virtualRow.start,
                      left: 0,
                      width: "100%",
                      height: ROW_HEIGHT,
                    }}
                    className="border-border hover:bg-muted flex items-center truncate border-b px-2 text-left text-xs"
                  >
                    {row.task.title}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto">
            <div style={{ width: gridWidth }}>
              <div
                className="border-border bg-muted sticky top-0 z-10 flex border-b"
                style={{ height: 28 }}
              >
                {days.map((d) => (
                  <div
                    key={d.date}
                    style={{ width: DAY_WIDTH }}
                    className={`text-muted-foreground flex shrink-0 items-center justify-center border-r border-border/50 text-[11px] ${
                      d.isWeekend ? "bg-muted/70" : ""
                    }`}
                  >
                    {d.isMonthStart ? `${d.day} •` : d.day}
                  </div>
                ))}
              </div>

              <div style={{ position: "relative", width: gridWidth, height: gridHeight }}>
                {todayOffset >= 0 && (
                  <div
                    data-testid="gantt-today-line"
                    style={{
                      left: todayOffset * DAY_WIDTH,
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: 1,
                    }}
                    className="bg-primary/60"
                  />
                )}

                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (!row) return null;
                  const { task, barSpan } = row;
                  const offset = ganttBarOffset(barSpan, range);
                  if (task.isMilestone) {
                    const center = offset.left * DAY_WIDTH + DAY_WIDTH / 2;
                    const middle = virtualRow.start + ROW_HEIGHT / 2;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        data-testid={`gantt-milestone-${task.id}`}
                        aria-label={task.title}
                        onClick={() => onOpenTask(task.id)}
                        style={{
                          position: "absolute",
                          left: center - 6,
                          top: middle - 6,
                          width: 12,
                          height: 12,
                          transform: "rotate(45deg)",
                        }}
                        className="bg-foreground hover:opacity-80"
                        title={task.title}
                      />
                    );
                  }
                  // The bar itself only ever spans the task's actual date
                  // range, which for a short task can be too narrow to hold
                  // its own title — rather than truncating the label inside
                  // it (unreadable for anything but the shortest titles),
                  // the label sits beside the bar and is free to run into
                  // the empty timeline to its right.
                  const barWidth = Math.max(offset.width * DAY_WIDTH - 4, 8);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      data-testid={`gantt-bar-${task.id}`}
                      onClick={() => onOpenTask(task.id)}
                      style={{
                        position: "absolute",
                        left: offset.left * DAY_WIDTH + 2,
                        top: virtualRow.start + 6,
                        height: ROW_HEIGHT - 12,
                      }}
                      className="hover:opacity-90 flex max-w-none items-center gap-1.5 text-left"
                      title={task.title}
                    >
                      <span
                        style={{ width: barWidth }}
                        className="bg-primary/80 h-full shrink-0 rounded"
                        aria-hidden
                      />
                      <span className="text-foreground bg-background/80 rounded px-1 text-[11px] whitespace-nowrap">
                        {task.title}
                      </span>
                    </button>
                  );
                })}

                <svg
                  data-testid="gantt-dependency-arrows"
                  width={gridWidth}
                  height={gridHeight}
                  style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
                >
                  <defs>
                    <marker
                      id="gantt-arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="6"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0,0 L6,3 L0,6 Z" className="fill-foreground" />
                    </marker>
                  </defs>
                  {visibleDeps.map((dep: Dependency) => {
                    const fromRow = rows[rowIndexByTaskId.get(dep.dependsOnTaskId)!]!;
                    const toRow = rows[rowIndexByTaskId.get(dep.taskId)!]!;
                    const fromOffset = ganttBarOffset(fromRow.barSpan, range);
                    const toOffset = ganttBarOffset(toRow.barSpan, range);
                    const x1 = (fromOffset.left + fromOffset.width) * DAY_WIDTH;
                    const y1 =
                      rowIndexByTaskId.get(dep.dependsOnTaskId)! * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const x2 = toOffset.left * DAY_WIDTH;
                    const y2 = rowIndexByTaskId.get(dep.taskId)! * ROW_HEIGHT + ROW_HEIGHT / 2;
                    return (
                      <line
                        key={dep.id}
                        data-testid={`gantt-arrow-${dep.id}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        className={
                          dep.kind === "blocks" ? "stroke-destructive" : "stroke-muted-foreground"
                        }
                        strokeWidth={1.5}
                        markerEnd="url(#gantt-arrow)"
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}

      {visibleDeps.length > 0 && (
        <div data-testid="gantt-dependency-list" className="space-y-1">
          <p className="text-xs font-medium">Dependencies</p>
          {visibleDeps.map((dep: Dependency) => {
            // dep.taskId depends on dep.dependsOnTaskId — read left-to-right
            // as "<task> depends on <dependency> (<kind>)", matching the
            // task detail panel's "Blocked by" wording, not the reversed
            // "<task> <kind> <dependency>" this milestone's predecessor spec
            // shipped with (see PROGRESS.md M3.4 decisions).
            const task = allTasks.find((t) => t.id === dep.taskId);
            const dependsOn = allTasks.find((t) => t.id === dep.dependsOnTaskId);
            return (
              <div key={dep.id} className="flex items-center gap-2 text-xs">
                <span>
                  {task?.title} <span className="text-muted-foreground">depends on</span>{" "}
                  {dependsOn?.title} <span className="text-muted-foreground">({dep.kind})</span>
                </span>
                <button
                  type="button"
                  data-testid={`gantt-dep-remove-${dep.id}`}
                  onClick={() => removeDependency.mutate({ dependencyId: dep.id })}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {undated.length > 0 && (
        <div data-testid="gantt-undated" className="space-y-2">
          <p className="text-xs font-medium">No date</p>
          <UndatedTasksList tasks={undated} onOpenTask={onOpenTask} />
        </div>
      )}
    </div>
  );
}
