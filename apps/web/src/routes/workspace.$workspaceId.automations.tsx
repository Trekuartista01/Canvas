import {
  newActionDraft,
  toAutomationActions,
  type ActionDraft,
} from "@/components/automation-action-draft";
import { AutomationActionsEditor } from "@/components/automation-actions-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { STATUS_KINDS, TASK_PRIORITIES, type StatusKind, type TaskPriority } from "@canvas/shared";
import { createRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const automationsListRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/automations",
  component: AutomationsListPage,
});

function AutomationsListPage() {
  const { workspaceId } = automationsListRoute.useParams();
  const utils = trpc.useUtils();
  const automations = trpc.automation.list.useQuery({ workspaceId });
  const tags = trpc.tag.list.useQuery({ workspaceId });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<"task_created" | "task_status_changed">(
    "task_status_changed",
  );
  const [toStatusKind, setToStatusKind] = useState<StatusKind>("done");
  const [conditionEnabled, setConditionEnabled] = useState(false);
  const [conditionPriority, setConditionPriority] = useState<TaskPriority>("normal");
  const [actions, setActions] = useState<ActionDraft[]>([newActionDraft()]);

  const create = trpc.automation.create.useMutation({
    onSuccess: () => {
      void utils.automation.list.invalidate({ workspaceId });
      setCreating(false);
      setName("");
      setActions([newActionDraft()]);
      setConditionEnabled(false);
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate({
      workspaceId,
      name: name.trim() || "Untitled automation",
      trigger:
        triggerType === "task_created"
          ? { type: "task_created" }
          : { type: "task_status_changed", toStatusKind },
      conditions: conditionEnabled ? [{ field: "priority", equals: conditionPriority }] : [],
      actions: toAutomationActions(actions),
    });
  }

  return (
    <div className="space-y-4 p-6" data-testid="automations-list-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
            <Zap className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Automations</h1>
            <p className="text-muted-foreground text-xs">
              Run actions automatically when tasks change.
            </p>
          </div>
        </div>
        {!creating && (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="automations-new"
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New automation
          </Button>
        )}
      </div>

      {creating && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>New automation</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <p className="text-muted-foreground text-xs">
                Watch for something happening, optionally only when a condition is true, then do
                something automatically.
              </p>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Automation name"
                className="h-8 text-sm"
                data-testid="automations-new-name"
              />

              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs font-medium">When</span>
                <select
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}
                  className="border-border bg-background h-8 rounded border text-sm"
                  data-testid="automations-trigger-type"
                >
                  <option value="task_created">a task is created</option>
                  <option value="task_status_changed">a task's status changes to…</option>
                </select>
                {triggerType === "task_status_changed" && (
                  <select
                    value={toStatusKind}
                    onChange={(e) => setToStatusKind(e.target.value as StatusKind)}
                    className="border-border bg-background h-8 rounded border text-sm"
                    data-testid="automations-trigger-status-kind"
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
                    data-testid="automations-condition-enabled"
                  />
                  Only if priority equals
                </label>
                {conditionEnabled && (
                  <select
                    value={conditionPriority}
                    onChange={(e) => setConditionPriority(e.target.value as TaskPriority)}
                    className="border-border bg-background h-8 rounded border text-sm"
                    data-testid="automations-condition-priority"
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
                <AutomationActionsEditor
                  actions={actions}
                  onChange={setActions}
                  tags={tags.data ?? []}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={create.isPending}
                  data-testid="automations-create-submit"
                >
                  {create.isPending ? "Creating…" : "Create automation"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
              {create.error && <p className="text-xs text-red-500">{create.error.message}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {automations.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (automations.data?.length ?? 0) === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          No automations yet. Create one to run actions automatically when tasks change.
        </Card>
      ) : (
        <Card className="divide-border divide-y overflow-hidden p-0">
          {automations.data?.map((automation) => (
            <Link
              key={automation.id}
              to="/w/$workspaceId/automations/$automationId"
              params={{ workspaceId, automationId: automation.id }}
              data-testid={`automations-link-${automation.id}`}
              className="hover:bg-muted flex items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <span className="font-medium">{automation.name}</span>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs ${automation.enabled ? "text-status-good" : "text-muted-foreground"}`}
                >
                  {automation.enabled ? "Enabled" : "Disabled"}
                </span>
                <ChevronRight className="text-muted-foreground h-4 w-4" aria-hidden />
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
