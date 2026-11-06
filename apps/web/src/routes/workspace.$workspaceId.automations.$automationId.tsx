import { toAutomationActions, type ActionDraft } from "@/components/automation-action-draft";
import { AutomationActionsEditor } from "@/components/automation-actions-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeAutomationRunLogEntry } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  automationActionSchema,
  automationConditionSchema,
  automationTriggerSchema,
  STATUS_KINDS,
  TASK_PRIORITIES,
  type StatusKind,
  type TaskPriority,
} from "@canvas/shared";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const automationEditorRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/automations/$automationId",
  component: AutomationEditorPage,
});

function draftFromAction(action: ReturnType<typeof automationActionSchema.parse>): ActionDraft {
  return {
    type: action.type,
    priority: action.type === "set_priority" ? action.priority : "normal",
    tagId: action.type === "add_tag" ? action.tagId : "",
    text: action.type === "post_comment" ? action.text : "",
    prompt: action.type === "generate_image" ? action.prompt : "",
    webhookUrl: action.type === "slack_notify" ? action.webhookUrl : "",
    message: action.type === "slack_notify" ? action.message : "",
  };
}

function AutomationEditorPage() {
  const { workspaceId, automationId } = automationEditorRoute.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const automation = trpc.automation.get.useQuery({ automationId });
  const runs = trpc.automation.runs.list.useQuery({ automationId });
  const tags = trpc.tag.list.useQuery({ workspaceId });

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<"task_created" | "task_status_changed">(
    "task_status_changed",
  );
  const [toStatusKind, setToStatusKind] = useState<StatusKind>("done");
  const [conditionEnabled, setConditionEnabled] = useState(false);
  const [conditionPriority, setConditionPriority] = useState<TaskPriority>("normal");
  const [actions, setActions] = useState<ActionDraft[]>([]);

  useEffect(() => {
    if (!automation.data) return;
    setName(automation.data.name);
    const trigger = automationTriggerSchema.parse(automation.data.triggerJson);
    setTriggerType(trigger.type);
    if (trigger.type === "task_status_changed") setToStatusKind(trigger.toStatusKind);
    const conditions = automationConditionSchema.array().parse(automation.data.conditionsJson);
    setConditionEnabled(conditions.length > 0);
    if (conditions[0]) setConditionPriority(conditions[0].equals);
    const parsedActions = automationActionSchema.array().parse(automation.data.actionsJson);
    setActions(parsedActions.map(draftFromAction));
  }, [automation.data]);

  const update = trpc.automation.update.useMutation({
    onSuccess: () => void utils.automation.get.invalidate({ automationId }),
  });
  const remove = trpc.automation.delete.useMutation({
    onSuccess: () => {
      void utils.automation.list.invalidate({ workspaceId });
      void navigate({ to: "/w/$workspaceId/automations", params: { workspaceId } });
    },
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      automationId,
      name: name.trim() || "Untitled automation",
      trigger:
        triggerType === "task_created"
          ? { type: "task_created" }
          : { type: "task_status_changed", toStatusKind },
      conditions: conditionEnabled ? [{ field: "priority", equals: conditionPriority }] : [],
      actions: toAutomationActions(actions),
    });
  }

  if (automation.isLoading || !automation.data) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }

  return (
    <div className="max-w-2xl space-y-4 p-6" data-testid="automation-editor-page">
      <Link
        to="/w/$workspaceId/automations"
        params={{ workspaceId }}
        className="text-muted-foreground hover:text-foreground text-xs"
      >
        ← Automations
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Edit automation</h1>

      <form onSubmit={handleSave} className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Watch for something happening, optionally only when a condition is true, then do something
          automatically.
        </p>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Automation name"
          className="h-8 text-sm"
          data-testid="automation-editor-name"
        />

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">When</span>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}
            className="border-border bg-background h-8 rounded border text-sm"
          >
            <option value="task_created">a task is created</option>
            <option value="task_status_changed">a task's status changes to…</option>
          </select>
          {triggerType === "task_status_changed" && (
            <select
              value={toStatusKind}
              onChange={(e) => setToStatusKind(e.target.value as StatusKind)}
              className="border-border bg-background h-8 rounded border text-sm"
            >
              {STATUS_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.charAt(0).toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={conditionEnabled}
              onChange={(e) => setConditionEnabled(e.target.checked)}
            />
            Only if priority equals
          </label>
          {conditionEnabled && (
            <select
              value={conditionPriority}
              onChange={(e) => setConditionPriority(e.target.value as TaskPriority)}
              className="border-border bg-background h-8 rounded border text-sm"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Then</span>
          <AutomationActionsEditor actions={actions} onChange={setActions} tags={tags.data ?? []} />
        </div>

        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={automation.data.enabled}
            onChange={(e) => update.mutate({ automationId, enabled: e.target.checked })}
            data-testid="automation-editor-enabled"
          />
          Enabled
        </label>

        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={update.isPending}
            data-testid="automation-editor-save"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => remove.mutate({ automationId })}
            data-testid="automation-editor-delete"
          >
            Delete automation
          </Button>
        </div>
        {update.error && <p className="text-xs text-red-500">{update.error.message}</p>}
      </form>

      <div>
        <h2 className="mb-1 text-base font-semibold">Runs</h2>
        {(runs.data?.length ?? 0) === 0 ? (
          <p className="text-muted-foreground text-sm">No runs yet.</p>
        ) : (
          <ul
            className="divide-border border-border divide-y rounded-md border"
            data-testid="automation-runs-list"
          >
            {runs.data?.map((run) => (
              <li
                key={run.id}
                className="px-3 py-2 text-sm"
                data-testid={`automation-run-${run.id}`}
              >
                <div className="flex items-center justify-between">
                  <span className={run.status === "success" ? "text-green-600" : "text-red-500"}>
                    {run.status}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>
                <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                  {(Array.isArray(run.logJson) ? run.logJson : []).map((entry, i) => (
                    <li key={i}>{describeAutomationRunLogEntry(entry)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
