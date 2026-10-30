import type { AppRouter } from "@canvas/api";
import { EmployeeOfMonthBanner } from "@/components/employee-of-month-banner";
import { MembersPanel } from "@/components/members-panel";
import { TaskHighlightRow } from "@/components/task-highlight-row";
import { TemplatesPanel } from "@/components/templates-panel";
import { Card } from "@/components/ui/card";
import { useMyAccess } from "@/hooks/use-my-access";
import { trpc } from "@/lib/trpc";
import { MANAGER_PEOPLE_ROLES } from "@canvas/shared";
import { createRoute, Link, Navigate } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronRight, ListChecks, Palette, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type HighlightTask = RouterOutputs["task"]["highlights"]["priority"][number];

export const workspaceHomeRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/",
  component: WorkspaceHome,
});

function TaskHighlightsSection({
  title,
  icon: Icon,
  emptyText,
  tasks,
  workspaceId,
  memberNamesById,
  testId,
}: {
  title: string;
  icon: typeof Sparkles;
  emptyText: string;
  tasks: HighlightTask[];
  workspaceId: string;
  memberNamesById: Map<string, string>;
  testId: string;
}) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-7 w-7 items-center justify-center rounded-md">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-xs">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <TaskHighlightRow
              key={task.id}
              task={task}
              workspaceId={workspaceId}
              memberNamesById={memberNamesById}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkspaceHome() {
  const { workspaceId } = workspaceHomeRoute.useParams();
  const highlights = trpc.task.highlights.useQuery({ workspaceId });
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const memberNamesById = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.userId, m.name])),
    [members.data],
  );
  const access = useMyAccess(workspaceId);

  // M7.1 role-based landing: this Home page is the team task view managers
  // land on; staff go straight to their own My Tasks.
  if (access.isLoading) return null;
  if (access.peopleRole && !MANAGER_PEOPLE_ROLES.includes(access.peopleRole)) {
    return <Navigate to="/w/$workspaceId/my-tasks" params={{ workspaceId }} replace />;
  }

  return (
    <div className="space-y-8 p-6">
      <EmployeeOfMonthBanner workspaceId={workspaceId} />
      <p className="text-muted-foreground text-sm">
        Select a list from the sidebar, or create a space to get started.
      </p>

      <TaskHighlightsSection
        title="Top priority"
        icon={Sparkles}
        emptyText="Nothing urgent, and nothing assigned to you right now."
        tasks={highlights.data?.priority ?? []}
        workspaceId={workspaceId}
        memberNamesById={memberNamesById}
        testId="home-top-priority"
      />

      <TaskHighlightsSection
        title="Recently added"
        icon={ListChecks}
        emptyText="No tasks yet."
        tasks={highlights.data?.recent ?? []}
        workspaceId={workspaceId}
        memberNamesById={memberNamesById}
        testId="home-recently-added"
      />

      <Link to="/w/$workspaceId/brand-kits" params={{ workspaceId }} className="block max-w-md">
        <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-muted">
          <span className="bg-accent-soft text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <Palette className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Brand Kits</p>
            <p className="text-muted-foreground text-xs">
              Save a palette and tone for each client, and assign one per space.
            </p>
          </div>
          <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
        </Card>
      </Link>
      <MembersPanel workspaceId={workspaceId} />
      <TemplatesPanel workspaceId={workspaceId} />
    </div>
  );
}
