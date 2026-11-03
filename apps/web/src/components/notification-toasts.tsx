import { leaveNotificationText } from "@/lib/leave-notification";
import { trpc } from "@/lib/trpc";
import { NOTIFICATION_VERB_LABELS } from "@canvas/shared";
import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "canvas.toastedNotifications";
const MAX_REMEMBERED = 200;
const SHOW_MS = 10_000;
/** Older unread notifications stay in the bell; only fresh ones pop up. */
const FRESH_MS = 24 * 60 * 60 * 1000;

function loadToasted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveToasted(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-MAX_REMEMBERED)));
  } catch {
    // Private mode / storage blocked: a toast may repeat after a reload — harmless.
  }
}

type Toast = { id: string; text: string; open: () => void };

/**
 * P8.4 (spec §3/§12): new notifications pop up once as toasts on Home, then
 * live on in the bell. Fed by the same notification.list query as the bell,
 * which the WS `notification` event refreshes at once (30 s poll otherwise).
 * "Shown once" is remembered per browser.
 */
export function NotificationToasts({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const notifications = trpc.notification.list.useQuery(undefined, { refetchInterval: 30_000 });
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toasted = useRef<Set<string>>(loadToasted());

  useEffect(() => {
    const now = Date.now();
    const fresh = (notifications.data ?? []).filter(
      (n) =>
        !n.readAt &&
        n.workspaceId === workspaceId &&
        !toasted.current.has(n.id) &&
        now - new Date(n.createdAt).getTime() < FRESH_MS,
    );
    if (fresh.length === 0) return;
    for (const n of fresh) toasted.current.add(n.id);
    saveToasted(toasted.current);
    setToasts((current) => [
      ...current,
      ...fresh.map((n) => ({
        id: n.id,
        text:
          leaveNotificationText(n.verb, n.payloadJson, n.actorName) ??
          `${n.actorName} ${NOTIFICATION_VERB_LABELS[n.verb] ?? "sent you an update"}`,
        open: () => {
          markRead.mutate({ notificationId: n.id });
          if (n.verb === "leave.requested") {
            void navigate({
              to: "/w/$workspaceId/leave-approvals",
              params: { workspaceId },
              search: { request: n.entityId },
            });
          } else if (n.verb.startsWith("leave.")) {
            void navigate({ to: "/w/$workspaceId/leave", params: { workspaceId } });
          }
        },
      })),
    ]);
    // markRead/navigate are stable enough; re-running on them would re-toast nothing anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.data, workspaceId]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((t) => t.slice(1)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismiss = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      data-testid="notification-toasts"
    >
      {toasts.slice(-3).map((t) => (
        <div
          key={t.id}
          className="border-border bg-background flex items-start gap-2 rounded-md border p-3 text-sm shadow-lg"
          role="status"
          data-testid="notification-toast"
        >
          <button
            type="button"
            className="min-w-0 flex-1 text-left hover:underline"
            onClick={() => {
              t.open();
              dismiss(t.id);
            }}
          >
            {t.text}
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => dismiss(t.id)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
