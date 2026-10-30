import type { AppRouter } from "@canvas/api";
import {
  presetToRRule,
  RECURRENCE_PRESET_LABELS,
  RECURRENCE_PRESETS,
  TASK_DEPENDENCY_KINDS,
  TASK_PRIORITIES,
  type RecurrencePreset,
  type TaskDependencyKind,
  formatDueTime,
} from "@canvas/shared";
import { ActivitySection } from "@/components/activity-section";
import { AttachmentsSection } from "@/components/attachments-section";
import { BrainChatPanel } from "@/components/brain-chat-panel";
import { ClipsSection } from "@/components/clips-section";
import { CommentsSection } from "@/components/comments-section";
import { CustomFieldsSection } from "@/components/custom-fields-section";
import { Field, Section } from "@/components/detail-field";
import { GenerationPanel } from "@/components/generation-panel";
import { TagsSection } from "@/components/tags-section";
import { TaskApprovalSection } from "@/components/task-approval-section";
import { CollaboratorsField, TransferControl } from "@/components/task-people-fields";
import { TimeTrackingSection } from "@/components/time-tracking-section";
import { Input } from "@/components/ui/input";
import { useOptimisticChecklistItemUpdate } from "@/hooks/use-checklist-mutations";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { inferRouterOutputs } from "@trpc/server";
import { useEffect, useState } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Status = RouterOutputs["status"]["list"][number];
type Member = RouterOutputs["workspace"]["members"][number];

const PRIORITY_LABEL: Record<(typeof TASK_PRIORITIES)[number], string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

// The server stores the resolved RRULE text, not the preset name — this
// reverses presetToRRule() so the "Repeats" select can show the current
// selection. Falls back to "" (Never) for any rule that doesn't match one
// of this milestone's presets exactly (not reachable via this UI, but the
// column can hold arbitrary RRULE text per DATA_MODEL.md).
function recurrencePresetFromRule(rrule: string): RecurrencePreset | "" {
  return RECURRENCE_PRESETS.find((p) => presetToRRule(p) === rrule) ?? "";
}

export function TaskDetailPanel({
  taskId,
  workspaceId,
  onClose,
  onOpenTask,
}: {
  taskId: string;
  workspaceId: string;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const task = trpc.task.get.useQuery({ taskId });
  const listId = task.data?.listId;

  const statuses = trpc.status.list.useQuery({ listId: listId ?? "" }, { enabled: !!listId });
  const members = trpc.workspace.members.useQuery({ workspaceId });

  const invalidate = () => {
    utils.task.get.invalidate({ taskId });
    if (listId) utils.task.list.invalidate({ listId });
  };
  const update = trpc.task.update.useMutation({ onSuccess: invalidate });
  const assign = trpc.task.assignees.add.useMutation({ onSuccess: invalidate });
  const unassign = trpc.task.assignees.remove.useMutation({ onSuccess: invalidate });
  const setRecurrence = trpc.task.recurrence.set.useMutation({ onSuccess: invalidate });
  const clearRecurrence = trpc.task.recurrence.clear.useMutation({ onSuccess: invalidate });

  const [title, setTitle] = useState("");
  const [brainOpen, setBrainOpen] = useState(false);
  const { containerRef, onKeyDown } = useModalA11y(onClose);
  const taskTitle = task.data?.title;
  useEffect(() => {
    if (taskTitle !== undefined) setTitle(taskTitle);
  }, [taskTitle]);

  // The list's first done-kind status (falling back to closed-kind) — what
  // "Finish task" moves a task to, same effect as dragging it to a Done
  // column on the Board but reachable without leaving the detail panel.
  const doneStatus =
    statuses.data?.find((s) => s.kind === "done") ??
    statuses.data?.find((s) => s.kind === "closed");
  const currentStatusKind = statuses.data?.find((s) => s.id === task.data?.statusId)?.kind;
  const isFinished = currentStatusKind === "done" || currentStatusKind === "closed";
  // M7.2: on a list with an approval step, only an approver may finish a
  // task outright (and never one awaiting approval — that's Approve, in the
  // Approval section); everyone else submits it for approval instead.
  const approval = trpc.task.approvalState.useQuery({ taskId });
  const canFinishDirectly =
    currentStatusKind !== "review" && (!approval.data?.hasReviewStatus || approval.data.isApprover);

  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const saveTemplate = trpc.taskTemplate.createFromTask.useMutation({
    onSuccess: () => {
      void utils.taskTemplate.list.invalidate({ workspaceId });
      setSavingTemplate(false);
      setTemplateName("");
    },
  });

  return (
    <div data-testid="task-detail-panel" className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close task details"
        title="Close task details"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={taskTitle ? `Task: ${taskTitle}` : "Task details"}
        tabIndex={-1}
        className="border-border bg-background relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l p-6 shadow-xl outline-none"
      >
        <div className="absolute top-4 right-4 flex items-center gap-3">
          {task.data && doneStatus && !isFinished && canFinishDirectly && (
            <button
              type="button"
              onClick={() => update.mutate({ taskId, statusId: doneStatus.id })}
              disabled={update.isPending}
              aria-label="Finish task"
              title="Finish task"
              data-testid="finish-task-button"
              className="text-status-good hover:opacity-80 text-sm font-medium"
            >
              ✓ Finish task
            </button>
          )}
          <button
            type="button"
            onClick={() => setSavingTemplate((s) => !s)}
            aria-label="Save as template"
            title="Save as template"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Save as template
          </button>
          <button
            type="button"
            onClick={() => setBrainOpen(true)}
            aria-label="Ask Brain about this task"
            title="Ask Brain about this task"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Ask Brain
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            ✕ Close
          </button>
        </div>

        {savingTemplate && (
          <form
            className="border-border bg-muted/40 mt-14 flex items-center gap-2 rounded-md border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (templateName.trim()) {
                saveTemplate.mutate({ taskId, name: templateName.trim() });
              }
            }}
          >
            <Input
              autoFocus
              value={templateName}
              placeholder="Template name"
              aria-label="Template name"
              onChange={(e) => setTemplateName(e.target.value)}
              className="h-7 text-xs"
            />
            <button
              type="submit"
              disabled={!templateName.trim() || saveTemplate.isPending}
              className="bg-primary text-primary-foreground h-7 shrink-0 rounded px-2 text-xs disabled:opacity-50"
            >
              Save
            </button>
          </form>
        )}

        {task.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

        {task.data && (
          <div className="mt-8 space-y-6">
            <Input
              value={title}
              aria-label="Task title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title.trim() !== task.data.title) {
                  update.mutate({ taskId, title: title.trim() });
                }
              }}
              className="h-auto border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            />

            <TaskApprovalSection
              taskId={taskId}
              statusKind={currentStatusKind}
              requiresProof={task.data.requiresProof}
              onChanged={invalidate}
            />

            {update.error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {update.error.message}
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Status">
                <select
                  value={task.data.statusId}
                  disabled={statuses.isLoading}
                  onChange={(e) => update.mutate({ taskId, statusId: e.target.value })}
                  className="border-border bg-background h-8 w-full rounded border text-sm"
                >
                  {(statuses.data ?? []).map((s: Status) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Priority">
                <select
                  value={task.data.priority ?? ""}
                  onChange={(e) =>
                    update.mutate({
                      taskId,
                      priority: e.target.value
                        ? (e.target.value as (typeof TASK_PRIORITIES)[number])
                        : null,
                    })
                  }
                  className="border-border bg-background h-8 w-full rounded border text-sm"
                >
                  <option value="">None</option>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Start date">
                <Input
                  type="date"
                  value={task.data.startDate ?? ""}
                  onChange={(e) => update.mutate({ taskId, startDate: e.target.value || null })}
                  className="h-8 text-sm"
                />
              </Field>

              <Field label="Due date">
                <Input
                  type="date"
                  data-testid="task-due-date"
                  value={task.data.dueDate ?? ""}
                  onChange={(e) => update.mutate({ taskId, dueDate: e.target.value || null })}
                  className="h-8 text-sm"
                />
              </Field>

              <Field label="Due time">
                <Input
                  type="time"
                  data-testid="task-due-time"
                  value={formatDueTime(task.data.dueTime) ?? ""}
                  disabled={!task.data.dueDate}
                  title={task.data.dueDate ? "Kosovo time" : "Set a due date first"}
                  onChange={(e) => update.mutate({ taskId, dueTime: e.target.value || null })}
                  className="h-8 text-sm"
                />
              </Field>

              <Field label="Requires proof photo">
                <input
                  type="checkbox"
                  data-testid="task-requires-proof"
                  checked={task.data.requiresProof}
                  onChange={(e) => update.mutate({ taskId, requiresProof: e.target.checked })}
                  className="h-4 w-4"
                />
              </Field>

              <Field label="Milestone">
                <input
                  type="checkbox"
                  data-testid="task-is-milestone"
                  checked={task.data.isMilestone}
                  onChange={(e) => update.mutate({ taskId, isMilestone: e.target.checked })}
                  className="h-4 w-4"
                />
              </Field>

              <Field label="Repeats">
                <select
                  data-testid="task-recurrence"
                  value={
                    task.data.recurrenceRule?.rrule
                      ? recurrencePresetFromRule(task.data.recurrenceRule.rrule)
                      : ""
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value) clearRecurrence.mutate({ taskId });
                    else setRecurrence.mutate({ taskId, preset: value as RecurrencePreset });
                  }}
                  className="border-border bg-background h-8 w-full rounded border text-sm"
                >
                  <option value="">Never</option>
                  {RECURRENCE_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {RECURRENCE_PRESET_LABELS[p]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Assignees">
              <div className="flex flex-wrap items-center gap-2">
                {task.data.assignees.map((a) => (
                  <span
                    key={a.userId}
                    className="border-border flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                  >
                    {a.name}
                    <button
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      title={`Remove ${a.name}`}
                      onClick={() => unassign.mutate({ taskId, userId: a.userId })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  aria-label="Assign someone"
                  onChange={(e) => {
                    if (e.target.value) assign.mutate({ taskId, userId: e.target.value });
                  }}
                  className="border-border bg-background h-7 rounded border text-xs"
                >
                  <option value="">+ Assign…</option>
                  {(members.data ?? [])
                    .filter((m: Member) => !task.data.assignees.some((a) => a.userId === m.userId))
                    .map((m: Member) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
              <TransferControl
                taskId={taskId}
                assignees={task.data.assignees}
                members={members.data ?? []}
                onChanged={invalidate}
              />
            </Field>

            <CollaboratorsField taskId={taskId} members={members.data ?? []} />

            <Field label="Description">
              <DescriptionEditor
                key={task.data.id}
                initialContent={task.data.descriptionJson}
                onSave={(json) => update.mutate({ taskId, descriptionJson: json })}
              />
            </Field>

            <DetailGroup label="Work">
              {!task.data.parentTaskId && (
                <SubtasksSection
                  taskId={taskId}
                  listId={task.data.listId}
                  subtasks={task.data.subtasks}
                  statuses={statuses.data ?? []}
                  onChanged={invalidate}
                  onOpenTask={onOpenTask}
                />
              )}

              <DependenciesSection
                taskId={taskId}
                listId={task.data.listId}
                dependencies={task.data.dependencies}
                statuses={statuses.data ?? []}
                onOpenTask={onOpenTask}
              />

              <RemindersSection taskId={taskId} />

              <TimeTrackingSection taskId={taskId} />

              <ChecklistsSection taskId={taskId} />

              <AttachmentsSection taskId={taskId} />

              <ClipsSection taskId={taskId} />

              <Section label="Generate image">
                <GenerationPanel
                  workspaceId={workspaceId}
                  taskId={taskId}
                  listId={listId}
                  onAskBrain={() => setBrainOpen(true)}
                />
              </Section>

              <TagsSection
                taskId={taskId}
                workspaceId={workspaceId}
                tags={task.data.tags}
                onChanged={invalidate}
              />

              <CustomFieldsSection
                taskId={taskId}
                workspaceId={workspaceId}
                listId={task.data.listId}
              />
            </DetailGroup>

            <DetailGroup label="Discussion">
              <CommentsSection taskId={taskId} workspaceId={workspaceId} />

              <ActivitySection taskId={taskId} />
            </DetailGroup>
          </div>
        )}
      </div>
      {brainOpen && (
        <BrainChatPanel
          workspaceId={workspaceId}
          contextType="task"
          contextId={taskId}
          onClose={() => setBrainOpen(false)}
        />
      )}
    </div>
  );
}

// Groups the panel's less-frequently-touched sections under a collapsible,
// labeled header — defaults open so nothing already relying on these fields
// being visible (tests, deep links) changes behavior; it just gives the
// panel a way to collapse past the core fields instead of one flat scroll.
function DetailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-border border-t pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
      >
        <span className={open ? "rotate-90" : ""} aria-hidden>
          ▸
        </span>
        {label}
      </button>
      {open && <div className="mt-4 space-y-6">{children}</div>}
    </div>
  );
}

function DescriptionEditor({
  initialContent,
  onSave,
}: {
  initialContent: unknown;
  onSave: (json: unknown) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (initialContent as object | undefined) ?? "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-32 focus:outline-none",
        "aria-label": "Description",
      },
    },
    onBlur: ({ editor }) => onSave(editor.getJSON()),
  });

  // `content` above only seeds the editor on creation — TipTap doesn't
  // reactively apply prop changes. If the task query resolves with fresher
  // data after this editor already mounted (e.g. reopening the panel while
  // the previous close's cache invalidation is still in flight), sync it in
  // explicitly. Guarded by a content comparison so we don't clobber the
  // user's cursor position on every keystroke-triggered re-render.
  useEffect(() => {
    if (!editor || initialContent === undefined) return;
    const incoming = JSON.stringify(initialContent);
    if (JSON.stringify(editor.getJSON()) !== incoming) {
      editor.commands.setContent((initialContent as object) ?? "");
    }
  }, [editor, initialContent]);

  return (
    <div className="border-border rounded-md border p-2">
      <EditorContent editor={editor} />
    </div>
  );
}

type Subtask = RouterOutputs["task"]["get"]["subtasks"][number];

function SubtasksSection({
  taskId,
  listId,
  subtasks,
  statuses,
  onChanged,
  onOpenTask,
}: {
  taskId: string;
  listId: string;
  subtasks: Subtask[];
  statuses: Status[];
  onChanged: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const create = trpc.task.create.useMutation({
    onSuccess: () => {
      onChanged();
      setTitle("");
    },
  });
  const del = trpc.task.delete.useMutation({ onSuccess: onChanged });

  const statusName = (statusId: string) => statuses.find((s) => s.id === statusId)?.name ?? "";

  return (
    <Section label={`Subtasks${subtasks.length ? ` (${subtasks.length})` : ""}`}>
      <div className="space-y-1">
        {subtasks.map((s) => (
          <div
            key={s.id}
            className="group border-border flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
          >
            {onOpenTask ? (
              <button
                type="button"
                onClick={() => onOpenTask(s.id)}
                className="flex-1 truncate text-left hover:underline"
              >
                {s.title}
              </button>
            ) : (
              <span className="flex-1 truncate">{s.title}</span>
            )}
            <span className="text-muted-foreground shrink-0 text-xs">{statusName(s.statusId)}</span>
            <button
              type="button"
              aria-label={`Delete subtask ${s.title}`}
              title={`Delete subtask ${s.title}`}
              onClick={() => del.mutate({ taskId: s.id })}
              className="text-muted-foreground hover:text-foreground hidden shrink-0 group-hover:inline"
            >
              ✕
            </button>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate({ listId, parentTaskId: taskId, title: title.trim() });
          }}
        >
          <Input
            value={title}
            placeholder="+ Add subtask"
            aria-label="New subtask"
            onChange={(e) => setTitle(e.target.value)}
            className="h-7 text-xs"
          />
        </form>
      </div>
    </Section>
  );
}

type TaskDependencies = RouterOutputs["task"]["get"]["dependencies"];

/**
 * M3.4: the full-management counterpart to the Gantt view's inline form
 * (M3.3) — "Blocked by" (this task depends on others) and "Blocking"
 * (others depend on this task), each removable, plus a form to add a new
 * "blocked by" edge from any other task in the same list. Cycle/self/
 * cross-list rejections come back from the server (validateTaskDependency /
 * wouldCreateCycle in apps/api/src/lib/dependency.ts) and surface inline.
 */
function DependenciesSection({
  taskId,
  listId,
  dependencies,
  statuses,
  onOpenTask,
}: {
  taskId: string;
  listId: string;
  dependencies: TaskDependencies;
  statuses: Status[];
  onOpenTask?: (taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.task.get.invalidate({ taskId });
  const tasks = trpc.task.list.useQuery({ listId });

  const [dependsOnTaskId, setDependsOnTaskId] = useState("");
  const [kind, setKind] = useState<TaskDependencyKind>("blocks");
  const [error, setError] = useState<string | null>(null);

  const add = trpc.task.dependencies.add.useMutation({
    onSuccess: () => {
      invalidate();
      setDependsOnTaskId("");
      setError(null);
    },
    onError: (err) => setError(err.message),
  });
  const remove = trpc.task.dependencies.remove.useMutation({ onSuccess: invalidate });

  const doneStatusIds = new Set(
    statuses.filter((s) => s.kind === "done" || s.kind === "closed").map((s) => s.id),
  );

  const linkedIds = new Set([
    taskId,
    ...dependencies.blockedBy.map((d) => d.task.id),
    ...dependencies.blocking.map((d) => d.task.id),
  ]);
  const candidates = (tasks.data ?? []).filter((t) => !linkedIds.has(t.id));

  function renderTask(dep: TaskDependencies["blockedBy"][number]) {
    const notDone = !doneStatusIds.has(dep.task.statusId);
    return (
      <div
        key={dep.id}
        className="group border-border flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
      >
        {onOpenTask ? (
          <button
            type="button"
            onClick={() => onOpenTask(dep.task.id)}
            className="flex-1 truncate text-left hover:underline"
          >
            {dep.task.title}
          </button>
        ) : (
          <span className="flex-1 truncate">{dep.task.title}</span>
        )}
        <span className="text-muted-foreground shrink-0 text-xs">
          {dep.kind === "blocks" ? "Blocks" : "Waiting on"}
        </span>
        {notDone && (
          <span className="text-destructive shrink-0 text-xs" title="Not done yet">
            ●
          </span>
        )}
        <button
          type="button"
          aria-label={`Remove dependency on ${dep.task.title}`}
          title={`Remove dependency on ${dep.task.title}`}
          onClick={() => remove.mutate({ dependencyId: dep.id })}
          className="text-muted-foreground hover:text-foreground hidden shrink-0 group-hover:inline"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <Section label="Dependencies">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Blocked by</p>
          {dependencies.blockedBy.length === 0 ? (
            <p className="text-muted-foreground text-xs">Nothing yet.</p>
          ) : (
            dependencies.blockedBy.map(renderTask)
          )}
        </div>

        {dependencies.blocking.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Blocking</p>
            {dependencies.blocking.map(renderTask)}
          </div>
        )}

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!dependsOnTaskId) return;
            add.mutate({ taskId, dependsOnTaskId, kind });
          }}
        >
          <select
            value={dependsOnTaskId}
            aria-label="Depends on"
            onChange={(e) => setDependsOnTaskId(e.target.value)}
            className="border-border bg-background h-7 rounded border text-xs"
          >
            <option value="">+ Add dependency…</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <select
            value={kind}
            aria-label="Dependency kind"
            onChange={(e) => setKind(e.target.value as TaskDependencyKind)}
            className="border-border bg-background h-7 rounded border text-xs"
          >
            {TASK_DEPENDENCY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "blocks" ? "Blocks" : "Waiting on"}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!dependsOnTaskId || add.isPending}
            className="bg-primary text-primary-foreground h-7 rounded px-2 text-xs disabled:opacity-50"
          >
            Add dependency
          </button>
        </form>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    </Section>
  );
}

/**
 * M3.5. reminder.list returns all of the caller's own undone reminders
 * (they're personal, not task-scoped server-side — see reminder.ts), so
 * this filters to the current task client-side; there are never enough of
 * a single user's reminders for that to matter.
 */
function RemindersSection({ taskId }: { taskId: string }) {
  const utils = trpc.useUtils();
  const reminders = trpc.reminder.list.useQuery();
  const invalidate = () => utils.reminder.list.invalidate();

  const [remindAt, setRemindAt] = useState("");
  const [note, setNote] = useState("");
  const create = trpc.reminder.create.useMutation({
    onSuccess: () => {
      invalidate();
      setRemindAt("");
      setNote("");
    },
  });
  const dismiss = trpc.reminder.dismiss.useMutation({ onSuccess: invalidate });

  const taskReminders = (reminders.data ?? []).filter((r) => r.taskId === taskId);

  return (
    <Section label="Reminders">
      <div className="space-y-2">
        {taskReminders.length === 0 && (
          <p className="text-muted-foreground text-xs">No reminders set.</p>
        )}
        {taskReminders.map((r) => (
          <div
            key={r.id}
            className="group border-border flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
          >
            <span className="flex-1 truncate">
              {new Date(r.remindAt).toLocaleString()}
              {r.note ? ` — ${r.note}` : ""}
            </span>
            <button
              type="button"
              aria-label="Dismiss reminder"
              title="Dismiss reminder"
              onClick={() => dismiss.mutate({ reminderId: r.id })}
              className="text-muted-foreground hover:text-foreground hidden shrink-0 group-hover:inline"
            >
              ✕
            </button>
          </div>
        ))}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!remindAt) return;
            create.mutate({ taskId, remindAt, note: note.trim() || undefined });
          }}
        >
          <Input
            type="datetime-local"
            aria-label="Remind me at"
            data-testid="reminder-remind-at"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            className="h-7 w-auto text-xs"
          />
          <Input
            value={note}
            placeholder="Note (optional)"
            aria-label="Reminder note"
            onChange={(e) => setNote(e.target.value)}
            className="h-7 text-xs"
          />
          <button
            type="submit"
            disabled={!remindAt || create.isPending}
            data-testid="reminder-add"
            className="bg-primary text-primary-foreground h-7 rounded px-2 text-xs disabled:opacity-50"
          >
            Remind me
          </button>
        </form>
      </div>
    </Section>
  );
}

function ChecklistsSection({ taskId }: { taskId: string }) {
  const utils = trpc.useUtils();
  const checklists = trpc.checklist.list.useQuery({ taskId });
  const invalidate = () => utils.checklist.list.invalidate({ taskId });

  const [name, setName] = useState("");
  const createChecklist = trpc.checklist.create.useMutation({
    onSuccess: () => {
      invalidate();
      setName("");
    },
  });
  const deleteChecklist = trpc.checklist.delete.useMutation({ onSuccess: invalidate });
  const createItem = trpc.checklist.items.create.useMutation({ onSuccess: invalidate });
  const updateItem = useOptimisticChecklistItemUpdate(taskId);
  const deleteItem = trpc.checklist.items.delete.useMutation({ onSuccess: invalidate });

  return (
    <Section label="Checklists">
      <div className="space-y-4">
        {(checklists.data ?? []).map((checklist) => {
          const doneCount = checklist.items.filter((i) => i.done).length;
          return (
            <div key={checklist.id} className="space-y-1">
              <div className="group flex items-center gap-2">
                <span className="text-sm font-medium">{checklist.name}</span>
                <span className="text-muted-foreground text-xs">
                  {doneCount}/{checklist.items.length}
                </span>
                <button
                  type="button"
                  aria-label={`Delete checklist ${checklist.name}`}
                  title={`Delete checklist ${checklist.name}`}
                  onClick={() => deleteChecklist.mutate({ checklistId: checklist.id })}
                  className="text-muted-foreground hover:text-foreground ml-auto hidden text-xs group-hover:inline"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-1">
                {checklist.items.map((item) => (
                  <div key={item.id} className="group flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.done}
                      aria-label={item.text}
                      onChange={(e) =>
                        updateItem.mutate({ itemId: item.id, done: e.target.checked })
                      }
                    />
                    <span className={item.done ? "text-muted-foreground line-through" : ""}>
                      {item.text}
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete item ${item.text}`}
                      title={`Delete item ${item.text}`}
                      onClick={() => deleteItem.mutate({ itemId: item.id })}
                      className="text-muted-foreground hover:text-foreground ml-auto hidden group-hover:inline"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <NewChecklistItemForm
                isPending={createItem.isPending}
                onSubmit={(text) => createItem.mutate({ checklistId: checklist.id, text })}
              />
            </div>
          );
        })}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createChecklist.mutate({ taskId, name: name.trim() });
          }}
        >
          <Input
            value={name}
            placeholder="+ Add checklist"
            aria-label="New checklist name"
            onChange={(e) => setName(e.target.value)}
            className="h-7 text-xs"
          />
        </form>
      </div>
    </Section>
  );
}

function NewChecklistItemForm({
  isPending,
  onSubmit,
}: {
  isPending: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) {
          onSubmit(text.trim());
          setText("");
        }
      }}
    >
      <Input
        value={text}
        placeholder="+ Add item"
        aria-label="New checklist item text"
        disabled={isPending}
        onChange={(e) => setText(e.target.value)}
        className="h-7 text-xs"
      />
    </form>
  );
}
