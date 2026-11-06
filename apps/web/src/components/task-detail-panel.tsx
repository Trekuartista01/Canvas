import type { AppRouter } from "@canvas/api";
import {
  presetToRRule,
  RECURRENCE_PRESET_LABELS,
  RECURRENCE_PRESETS,
  TASK_PRIORITIES,
  type RecurrencePreset,
  formatDueTime,
} from "@canvas/shared";
import { ActivitySection } from "@/components/activity-section";
import { BrainChatPanel } from "@/components/brain-chat-panel";
import { CardMoveField } from "@/components/card-move-field";
import { ClientField } from "@/components/client-field";
import { CommentsSection } from "@/components/comments-section";
import { Field } from "@/components/detail-field";
import { TaskApprovalSection } from "@/components/task-approval-section";
import { CollaboratorsField, TransferControl } from "@/components/task-people-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlignLeft,
  Bold,
  Bookmark,
  Check,
  Heading2,
  Italic,
  List,
  ListOrdered,
  MessagesSquare,
  Quote,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Status = RouterOutputs["status"]["list"][number];
type Member = RouterOutputs["workspace"]["members"][number];

const PRIORITY_LABEL: Record<(typeof TASK_PRIORITIES)[number], string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const SELECT_CLASS = "border-border bg-background h-9 w-full rounded-md border px-2 text-sm";

// The server stores the resolved RRULE text, not the preset name — this
// reverses presetToRRule() so the "Repeats" select can show the current
// selection. Falls back to "" (Never) for any rule that doesn't match one
// of this milestone's presets exactly (not reachable via this UI, but the
// column can hold arbitrary RRULE text per DATA_MODEL.md).
function recurrencePresetFromRule(rrule: string): RecurrencePreset | "" {
  return RECURRENCE_PRESETS.find((p) => presetToRRule(p) === rrule) ?? "";
}

function PanelSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-muted-foreground h-4 w-4" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function TaskDetailPanel({
  taskId,
  workspaceId,
  onClose,
}: {
  taskId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const task = trpc.task.get.useQuery({ taskId });
  const listId = task.data?.listId;

  const statuses = trpc.status.list.useQuery({ listId: listId ?? "" }, { enabled: !!listId });
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });
  const list = tree.data?.lists.find((l) => l.id === listId);
  const board = list ? tree.data?.spaces.find((s) => s.id === list.spaceId) : undefined;

  const invalidate = () => {
    void utils.task.get.invalidate({ taskId });
    if (listId) void utils.task.list.invalidate({ listId });
    // A status change can move the card to another column, and every task
    // page lists it under its status.
    void utils.task.list.invalidate();
    void utils.task.board.invalidate();
    void utils.task.listMine.invalidate();
    void utils.task.highlights.invalidate();
  };
  const update = trpc.task.update.useMutation({ onSuccess: invalidate });
  const assign = trpc.task.assignees.add.useMutation({ onSuccess: invalidate });
  const unassign = trpc.task.assignees.remove.useMutation({ onSuccess: invalidate });
  const setRecurrence = trpc.task.recurrence.set.useMutation({ onSuccess: invalidate });
  const clearRecurrence = trpc.task.recurrence.clear.useMutation({ onSuccess: invalidate });
  const remove = trpc.task.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const [title, setTitle] = useState("");
  const [brainOpen, setBrainOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  const currentStatus = statuses.data?.find((s) => s.id === task.data?.statusId);
  const currentStatusKind = currentStatus?.kind;
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

  const iconButton =
    "text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors";

  return (
    <div data-testid="task-detail-panel" className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close task details"
        title="Close task details"
        className="panel-backdrop absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={taskTitle ? `Task: ${taskTitle}` : "Task details"}
        tabIndex={-1}
        className="panel-slide bg-background relative flex h-full w-full max-w-xl flex-col shadow-2xl outline-none"
      >
        <header className="border-border bg-card flex shrink-0 items-center gap-2 border-b px-4 py-2.5 sm:px-6">
          <p className="text-muted-foreground mr-auto min-w-0 truncate text-xs">
            {board ? `${board.name} / ` : ""}
            <span className="text-foreground font-medium">{list?.name}</span>
          </p>
          <button
            type="button"
            onClick={() => setBrainOpen(true)}
            aria-label="Ask Brain about this task"
            title="Ask Brain about this task"
            className={iconButton}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Ask Brain</span>
          </button>
          <button
            type="button"
            onClick={() => setSavingTemplate((s) => !s)}
            aria-label="Save as template"
            title="Save as template"
            className={iconButton}
          >
            <Bookmark className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Template</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete task"
            title="Delete task"
            data-testid="delete-task-button"
            className="text-status-critical hover:bg-status-critical/10 flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Delete</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className={iconButton}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {confirmingDelete && (
            <div
              role="alert"
              data-testid="delete-task-confirm"
              className="border-status-critical/40 bg-status-critical/10 mb-5 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <span className="mr-auto font-medium">Delete this task and its subtasks?</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep it
              </Button>
              <button
                type="button"
                disabled={remove.isPending}
                data-testid="delete-task-confirm-button"
                onClick={() => remove.mutate({ taskId })}
                className="bg-status-critical h-8 rounded-md px-3 text-xs font-medium text-white disabled:opacity-50"
              >
                Yes, delete
              </button>
              {remove.error && (
                <p className="w-full text-sm text-red-600 dark:text-red-400">
                  {remove.error.message}
                </p>
              )}
            </div>
          )}

          {savingTemplate && (
            <form
              className="border-border bg-card mb-5 flex items-center gap-2 rounded-lg border p-2"
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
                className="h-8 text-sm"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!templateName.trim() || saveTemplate.isPending}
              >
                Save
              </Button>
            </form>
          )}

          {task.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

          {task.data && (
            <div className="space-y-6">
              <div className="space-y-3">
                <Input
                  value={title}
                  aria-label="Task title"
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title.trim() && title.trim() !== task.data.title) {
                      update.mutate({ taskId, title: title.trim() });
                    }
                  }}
                  className="h-auto border-none bg-transparent px-0 text-2xl font-bold tracking-tight shadow-none focus-visible:ring-0"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className="border-border bg-card flex h-9 items-center gap-2 rounded-full border pr-1 pl-3 text-sm font-medium shadow-sm"
                    style={currentStatus ? { borderColor: currentStatus.color } : undefined}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: currentStatus?.color }}
                      aria-hidden
                    />
                    <span className="sr-only">Status</span>
                    <select
                      value={task.data.statusId}
                      disabled={statuses.isLoading}
                      onChange={(e) => update.mutate({ taskId, statusId: e.target.value })}
                      className="h-8 bg-transparent pr-1 text-sm font-medium outline-none"
                    >
                      {(statuses.data ?? []).map((s: Status) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {doneStatus && !isFinished && canFinishDirectly && (
                    <button
                      type="button"
                      onClick={() => update.mutate({ taskId, statusId: doneStatus.id })}
                      disabled={update.isPending}
                      aria-label="Finish task"
                      title="Finish task"
                      data-testid="finish-task-button"
                      className="bg-status-good flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      Finish task
                    </button>
                  )}
                </div>
              </div>

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

              <PanelSection icon={AlignLeft} title="Description">
                <DescriptionEditor
                  key={task.data.id}
                  initialContent={task.data.descriptionJson}
                  onSave={(json) => update.mutate({ taskId, descriptionJson: json })}
                />
              </PanelSection>

              <PanelSection icon={SlidersHorizontal} title="Details">
                <div className="border-border bg-card space-y-4 rounded-xl border p-4 shadow-sm">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
                        className={SELECT_CLASS}
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
                        onChange={(e) =>
                          update.mutate({ taskId, startDate: e.target.value || null })
                        }
                        className="h-9 text-sm"
                      />
                    </Field>

                    <Field label="Due date">
                      <Input
                        type="date"
                        data-testid="task-due-date"
                        value={task.data.dueDate ?? ""}
                        onChange={(e) => update.mutate({ taskId, dueDate: e.target.value || null })}
                        className="h-9 text-sm"
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
                        className="h-9 text-sm"
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
                        className={SELECT_CLASS}
                      >
                        <option value="">Never</option>
                        {RECURRENCE_PRESETS.map((p) => (
                          <option key={p} value={p}>
                            {RECURRENCE_PRESET_LABELS[p]}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <div className="space-y-2 self-end text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          data-testid="task-requires-proof"
                          checked={task.data.requiresProof}
                          onChange={(e) =>
                            update.mutate({ taskId, requiresProof: e.target.checked })
                          }
                          className="h-4 w-4"
                        />
                        Requires proof photo
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          data-testid="task-is-milestone"
                          checked={task.data.isMilestone}
                          onChange={(e) => update.mutate({ taskId, isMilestone: e.target.checked })}
                          className="h-4 w-4"
                        />
                        Milestone
                      </label>
                    </div>
                  </div>

                  <div className="border-border space-y-4 border-t pt-4">
                    <Field label="Assignees">
                      <div className="flex flex-wrap items-center gap-2">
                        {task.data.assignees.map((a) => (
                          <span
                            key={a.userId}
                            className="bg-accent-soft text-accent flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                          >
                            {a.name}
                            <button
                              type="button"
                              aria-label={`Remove ${a.name}`}
                              title={`Remove ${a.name}`}
                              onClick={() => unassign.mutate({ taskId, userId: a.userId })}
                              className="hover:opacity-70"
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          </span>
                        ))}
                        <select
                          value=""
                          aria-label="Assign someone"
                          onChange={(e) => {
                            if (e.target.value) assign.mutate({ taskId, userId: e.target.value });
                          }}
                          className="border-border bg-background h-7 rounded-md border text-xs"
                        >
                          <option value="">+ Assign…</option>
                          {(members.data ?? [])
                            .filter(
                              (m: Member) =>
                                !task.data.assignees.some((a) => a.userId === m.userId),
                            )
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

                    <ClientField
                      workspaceId={workspaceId}
                      taskId={taskId}
                      client={task.data.client}
                      detected={!task.data.clientSetManually}
                      suggestions={task.data.clientSuggestions}
                    />

                    <CardMoveField
                      workspaceId={workspaceId}
                      taskId={taskId}
                      listId={task.data.listId}
                      onArchived={onClose}
                    />
                  </div>
                </div>
              </PanelSection>

              <PanelSection icon={MessagesSquare} title="Discussion">
                <div className="space-y-6">
                  <CommentsSection taskId={taskId} workspaceId={workspaceId} />
                  <ActivitySection taskId={taskId} />
                </div>
              </PanelSection>
            </div>
          )}
        </div>
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
        class: "prose prose-sm dark:prose-invert max-w-none min-h-32 focus:outline-none",
        "aria-label": "Description",
      },
    },
    onBlur: ({ editor }) => onSave(editor.getJSON()),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            empty: e.isEmpty,
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            heading: e.isActive("heading", { level: 2 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
          }
        : null,
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

  const tools: { label: string; icon: LucideIcon; active?: boolean; run: () => void }[] = [
    {
      label: "Bold",
      icon: Bold,
      active: state?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      active: state?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "Heading",
      icon: Heading2,
      active: state?.heading,
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Bullet list",
      icon: List,
      active: state?.bullet,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: state?.ordered,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Quote",
      icon: Quote,
      active: state?.quote,
      run: () => editor?.chain().focus().toggleBlockquote().run(),
    },
  ];

  return (
    <div className="border-border bg-card focus-within:border-accent focus-within:ring-accent/20 overflow-hidden rounded-xl border shadow-sm transition-shadow focus-within:ring-2">
      <div
        className="border-border bg-muted/50 flex items-center gap-0.5 border-b px-2 py-1"
        role="toolbar"
        aria-label="Text formatting"
      >
        {tools.map(({ label, icon: Icon, active, run }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={!!active}
            title={label}
            // Keeps the text selected and the editor from saving on blur.
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              active
                ? "bg-accent-soft text-accent"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        ))}
      </div>
      <div className="relative px-4 py-3">
        {state?.empty && (
          <p className="text-muted-foreground pointer-events-none absolute top-3 left-4 text-sm">
            Add the brief, links or notes for this task…
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
