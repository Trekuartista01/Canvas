import { HolidayCalendar } from "@/components/holiday-calendar";
import { trpc } from "@/lib/trpc";
import { todayReportDate } from "@canvas/shared";
import { createRoute, Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const holidaysRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/holidays",
  component: HolidaysPage,
});

// Everyone reads the official holidays here. Since P8.2 HR edits them in
// Leave approvals → Official holidays; this page links there.
function HolidaysPage() {
  const { workspaceId } = holidaysRoute.useParams();
  const year = Number(todayReportDate(new Date()).slice(0, 4));
  const access = trpc.holiday.list.useQuery({ workspaceId, year });

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6" data-testid="holidays-page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <CalendarDays className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mr-auto text-lg font-semibold">Festat zyrtare / Official holidays</h1>
        {access.data?.canManage && (
          <Link
            to="/w/$workspaceId/leave-approvals"
            params={{ workspaceId }}
            search={{ tab: "holidays" }}
            className="text-accent text-sm font-medium hover:underline"
            data-testid="holidays-edit-link"
          >
            Edit in Leave approvals
          </Link>
        )}
      </div>
      <HolidayCalendar workspaceId={workspaceId} manage={false} />
    </div>
  );
}
