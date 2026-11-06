import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { LayoutGrid, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const dashboardsListRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/dashboards",
  component: DashboardsListPage,
});

function DashboardsListPage() {
  const { workspaceId } = dashboardsListRoute.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const dashboards = trpc.dashboard.list.useQuery({ workspaceId });
  const create = trpc.dashboard.create.useMutation({
    onSuccess: (dashboard) => {
      void utils.dashboard.list.invalidate({ workspaceId });
      void navigate({
        to: "/w/$workspaceId/dashboards/$dashboardId",
        params: { workspaceId, dashboardId: dashboard.id },
      });
    },
  });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate({ workspaceId, name: name.trim() || "Untitled dashboard" });
    setName("");
  }

  return (
    <div className="space-y-4 p-6" data-testid="dashboards-list-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
        {!creating && (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="dashboards-new"
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New dashboard
          </Button>
        )}
      </div>

      {creating && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>New dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New dashboard name"
                className="h-8 text-sm"
                data-testid="dashboards-new-name"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={create.isPending}
                  data-testid="dashboards-create"
                >
                  {create.isPending ? "Creating…" : "Create dashboard"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCreating(false);
                    setName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
              {create.error && <p className="text-xs text-red-500">{create.error.message}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {dashboards.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (dashboards.data?.length ?? 0) === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          No dashboards yet. Create one to chart tasks, time, and AI usage.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.data?.map((dashboard) => (
            <Link
              key={dashboard.id}
              to="/w/$workspaceId/dashboards/$dashboardId"
              params={{ workspaceId, dashboardId: dashboard.id }}
              data-testid={`dashboards-link-${dashboard.id}`}
            >
              <Card className="hover:border-accent flex items-start gap-3 p-4 transition-colors">
                <span className="bg-accent-soft text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                  <LayoutGrid className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{dashboard.name}</p>
                  <p className="text-muted-foreground text-xs">
                    Updated {new Date(dashboard.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
