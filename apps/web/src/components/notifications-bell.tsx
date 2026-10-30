import { NOTIFICATION_VERB_LABELS } from "@canvas/shared";
import { formatRelativeTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

// Verbs whose payloadJson carries {taskId, listId} — clicking navigates
// straight to the task.
const TASK_LINK_VERBS = new Set([
  "comment.created",
  "reminder.fired",
  "task.assigned",
  "task.priority_urgent",
  "task.completed",
  "task.completed_via_form",
  "task.submitted_for_review",
  "task.approved",
  "task.rejected",
  "task.transferred",
]);

// Scheduler-sent, so shown as the bare label rather than "<actor> <verb>".
const STANDALONE_VERBS = new Set(["reminder.fired", "daily_report.reminder"]);

const COMPLETED_VERBS = new Set(["task.completed", "task.completed_via_form"]);

function taskLink(payload: unknown): { taskId: string; listId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { taskId?: unknown; listId?: unknown };
  if (typeof p.taskId === "string" && typeof p.listId === "string") {
    return { taskId: p.taskId, listId: p.listId };
  }
  return null;
}

function reminderNote(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const note = (payload as { note?: unknown }).note;
  return typeof note === "string" && note ? note : null;
}

function completedTaskTitle(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const title = (payload as { title?: unknown }).title;
  return typeof title === "string" && title ? title : null;
}

// Only set on task.completed_via_form — the self-reported name of an
// external, session-less form submitter, since there's no real user to
// read an actor name off of for that verb.
// M7.4 "holiday.upcoming": "Europe Day — day off Mon 11 May".
function holidayLine(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as { name?: unknown; observedDate?: unknown };
  const name = typeof p.name === "string" ? p.name : "";
  if (typeof p.observedDate !== "string") return name;
  const day = new Date(`${p.observedDate}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${name} — day off ${day}`;
}

function formSubmitterName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const name = (payload as { submitterName?: unknown }).submitterName;
  return typeof name === "string" && name ? name : null;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const notifications = trpc.notification.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });
  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });

  const entries = notifications.data ?? [];
  const unreadCount = entries.filter((n) => !n.readAt).length;

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        title="Notifications"
        className="text-muted-foreground hover:text-foreground relative text-xs"
      >
        🔔
        {unreadCount > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-2 rounded-full px-1 text-[10px] leading-tight">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="border-border bg-background absolute top-full left-0 z-50 mt-1 w-72 rounded-md border shadow-lg">
          <div className="border-border flex items-center justify-between border-b px-2 py-1.5">
            <span className="text-xs font-medium">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {entries.length === 0 && (
              <p className="text-muted-foreground p-3 text-xs">No notifications yet.</p>
            )}
            {entries.map((n) => {
              const link = TASK_LINK_VERBS.has(n.verb) ? taskLink(n.payloadJson) : null;
              const note = n.verb === "reminder.fired" ? reminderNote(n.payloadJson) : null;
              const completedTitle = COMPLETED_VERBS.has(n.verb)
                ? completedTaskTitle(n.payloadJson)
                : null;
              const submitterName =
                n.verb === "task.completed_via_form" ? formSubmitterName(n.payloadJson) : null;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.readAt) markRead.mutate({ notificationId: n.id });
                    setOpen(false);
                    if (link) {
                      navigate({
                        to: "/w/$workspaceId/l/$listId",
                        params: { workspaceId: n.workspaceId, listId: link.listId },
                        search: { openTask: link.taskId },
                      });
                    } else if (n.verb === "daily_report.reminder") {
                      navigate({
                        to: "/w/$workspaceId/daily-report",
                        params: { workspaceId: n.workspaceId },
                      });
                    } else if (n.verb === "holiday.upcoming") {
                      navigate({
                        to: "/w/$workspaceId/holidays",
                        params: { workspaceId: n.workspaceId },
                      });
                    }
                  }}
                  className={`border-border block w-full border-b px-2 py-2 text-left text-xs last:border-b-0 ${
                    n.readAt ? "" : "bg-muted/50"
                  } hover:bg-muted`}
                >
                  {n.verb === "holiday.upcoming" ? (
                    <span>
                      <span className="font-medium">Public holiday:</span>{" "}
                      {holidayLine(n.payloadJson)}
                    </span>
                  ) : STANDALONE_VERBS.has(n.verb) ? (
                    <span className="font-medium">{NOTIFICATION_VERB_LABELS[n.verb]}</span>
                  ) : completedTitle ? (
                    <>
                      <span className="font-medium">{submitterName ?? n.actorName}</span> finished{" "}
                      <span className="font-medium">&ldquo;{completedTitle}&rdquo;</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{n.actorName}</span>{" "}
                      {NOTIFICATION_VERB_LABELS[n.verb] ?? "sent you an update"}
                    </>
                  )}
                  {note && <div className="mt-0.5">{note}</div>}
                  <div className="text-muted-foreground mt-0.5">
                    {completedTitle
                      ? new Date(n.createdAt).toLocaleString()
                      : formatRelativeTime(new Date(n.createdAt))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
