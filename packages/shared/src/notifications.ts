/**
 * Human-readable labels for `activity.verb` values that generate a
 * notification — shared by `NotificationsBell` (web) and the email digest
 * builder (apps/api/src/lib/digest.ts, M3.9) so the two surfaces read the
 * same way. Extracted from what was a `notifications-bell.tsx`-local map.
 */
export const NOTIFICATION_VERB_LABELS: Record<string, string> = {
  "comment.created": "mentioned you in a comment",
  "reminder.fired": "Reminder",
  "task.assigned": "assigned you a task",
  "task.priority_urgent": "flagged a task as urgent",
  "task.completed": "finished a task",
  // A task bound to a public "task completion" form (form.ts's
  // submitPublic) was marked done by an external, session-less submitter
  // — same shape as task.completed's payload plus a self-reported
  // submitterName, since there's no real user to read a name off of.
  "task.completed_via_form": "finished a task",
  // M7.2 approval flow.
  "task.submitted_for_review": "sent a task for your approval",
  "task.approved": "approved your task",
  "task.rejected": "sent a task back to you",
  "task.transferred": "transferred a task",
  // M7.3 — shown on its own, without an actor name (the scheduler sends it).
  "daily_report.reminder": "Reminder: submit today's daily report",
  // M7.4 — rendered with the holiday name and date from the payload.
  "holiday.upcoming": "Public holiday coming up",
  // M7.5 leave.
  "leave.requested": "asked for leave",
  "leave.approved": "approved your leave",
  "leave.rejected": "turned down your leave request",
  "leave.recorded": "recorded leave for you",
  "leave.cancelled": "cancelled your leave",
  // M7.6 — rendered with the employee and days left from the payload.
  "contract.expiring": "Contract expiring soon",
};
