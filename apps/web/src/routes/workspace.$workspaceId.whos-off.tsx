import { LeaveMonthCalendar } from "@/components/leave-month-calendar";
import { createRoute } from "@tanstack/react-router";
import { CalendarRange } from "lucide-react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const whosOffRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/whos-off",
  component: WhosOffPage,
});

// M7.5: approved leave on a month grid. Everyone sees who's away; the leave
// type only shows for people whose leave the viewer may see (server-side).
function WhosOffPage() {
  const { workspaceId } = whosOffRoute.useParams();
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-6" data-testid="whos-off-page">
      <LeaveMonthCalendar
        workspaceId={workspaceId}
        title={
          <div className="flex items-center gap-2">
            <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
              <CalendarRange className="h-5 w-5" aria-hidden />
            </span>
            <h1 className="text-lg font-semibold">Who's off</h1>
          </div>
        }
      />
    </div>
  );
}
