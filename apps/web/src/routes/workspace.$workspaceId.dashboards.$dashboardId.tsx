import { DashboardWidget } from "@/components/dashboard-widget";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { WIDGET_TYPES, type WidgetType } from "@canvas/shared";
import { createRoute, Link } from "@tanstack/react-router";
import { LayoutGrid, Plus } from "lucide-react";
import { useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const dashboardEditorRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/dashboards/$dashboardId",
  component: DashboardEditorPage,
});

const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  task_counts: "Task counts",
  burndown: "Tasks remaining over time",
  time_tracked: "Time tracked",
  ai_usage_cost: "AI usage cost",
  assignee_breakdown: "Open tasks by assignee",
  priority_breakdown: "Open tasks by priority",
};

const HAS_DAYS_CONFIG = new Set<WidgetType>(["burndown", "time_tracked", "ai_usage_cost"]);
const NO_CONFIG_TYPES = new Set<WidgetType>([
  "task_counts",
  "assignee_breakdown",
  "priority_breakdown",
]);

function DashboardEditorPage() {
  const { workspaceId, dashboardId } = dashboardEditorRoute.useParams();
  const utils = trpc.useUtils();
  const dashboard = trpc.dashboard.get.useQuery({ dashboardId });

  const [widgetType, setWidgetType] = useState<WidgetType>("task_counts");
  const [days, setDays] = useState(14);

  const invalidate = () => utils.dashboard.get.invalidate({ dashboardId });
  const addWidget = trpc.dashboard.widget.add.useMutation({ onSuccess: invalidate });

  function handleAddWidget() {
    const config: Parameters<typeof addWidget.mutate>[0]["config"] = HAS_DAYS_CONFIG.has(widgetType)
      ? { type: widgetType as "burndown" | "time_tracked" | "ai_usage_cost", days }
      : NO_CONFIG_TYPES.has(widgetType)
        ? { type: widgetType as "task_counts" | "assignee_breakdown" | "priority_breakdown" }
        : { type: "task_counts" };
    addWidget.mutate({ dashboardId, config });
  }

  if (dashboard.isLoading || !dashboard.data) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }

  return (
    <div className="space-y-6 p-6" data-testid="dashboard-editor-page">
      <Link
        to="/w/$workspaceId/dashboards"
        params={{ workspaceId }}
        className="text-muted-foreground hover:text-foreground text-xs"
      >
        ← Dashboards
      </Link>
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <LayoutGrid className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">{dashboard.data.name}</h1>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <select
          value={widgetType}
          onChange={(e) => setWidgetType(e.target.value as WidgetType)}
          className="border-border bg-background h-8 rounded border text-sm"
          data-testid="widget-type-select"
        >
          {WIDGET_TYPES.map((type) => (
            <option key={type} value={type}>
              {WIDGET_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {HAS_DAYS_CONFIG.has(widgetType) && (
          <label className="flex items-center gap-1 text-xs">
            Days
            <Input
              type="number"
              min={7}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-8 w-16 text-sm"
            />
          </label>
        )}
        <Button
          type="button"
          size="sm"
          onClick={handleAddWidget}
          disabled={addWidget.isPending}
          data-testid="add-widget"
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add widget
        </Button>
      </Card>

      {dashboard.data.widgets.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          No widgets yet. Add one above to chart tasks, time, or AI usage.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="widget-grid">
          {dashboard.data.widgets.map((widget) => (
            <DashboardWidget key={widget.id} widget={widget} onRemoved={invalidate} />
          ))}
        </div>
      )}
    </div>
  );
}
