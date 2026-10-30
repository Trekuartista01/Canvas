import { LEAVE_STATUS_LABELS, type LeaveStatus } from "@canvas/shared";

const STATUS_CLASS: Record<LeaveStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-green-500/15 text-green-700 dark:text-green-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}>
      {LEAVE_STATUS_LABELS[status]}
    </span>
  );
}

/** "2 Mar – 6 Mar 2027", or one day. */
export function formatLeaveRange(startDate: string, endDate: string) {
  const fmt = (d: string, withYear: boolean) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  return startDate === endDate
    ? fmt(startDate, true)
    : `${fmt(startDate, false)} – ${fmt(endDate, true)}`;
}
