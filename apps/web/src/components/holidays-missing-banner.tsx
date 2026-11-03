import { trpc } from "@/lib/trpc";
import { Link } from "@tanstack/react-router";
import { CalendarPlus } from "lucide-react";

/**
 * P8.2: HR only, in December — next year's official holidays are missing or
 * an Eid date still needs confirming. The server decides; the query answers
 * `missing: false` for everyone else.
 */
export function HolidaysMissingBanner({ workspaceId }: { workspaceId: string }) {
  const reminder = trpc.holiday.reminder.useQuery({ workspaceId });
  if (!reminder.data?.missing) return null;
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      role="status"
      data-testid="holidays-missing-banner"
    >
      <CalendarPlus className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
      <span className="mr-auto">
        <span className="font-medium">Add next year&rsquo;s official holidays.</span>{" "}
        <span className="text-muted-foreground">
          Check {reminder.data.year}&rsquo;s calendar and confirm the Eid dates.
        </span>
      </span>
      <Link
        to="/w/$workspaceId/leave-approvals"
        params={{ workspaceId }}
        search={{ tab: "holidays" }}
        className="text-accent text-xs font-medium hover:underline"
      >
        Open calendar
      </Link>
    </div>
  );
}
