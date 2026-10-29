import { realtimeEventSchema } from "@canvas/shared";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";

const RECONNECT_DELAY_MS = 2000;

/**
 * Live board/list collaboration: the server publishes a bare
 * invalidation event per ARCHITECTURE.md's realtime protocol ({entity, id,
 * ...scoping id, kind} — no payload over the wire), and every connected
 * client just refetches whatever query the event touches via TanStack
 * Query. Reconnects on drop with a fixed short delay — without it, a
 * network hiccup would silently and permanently end live updates for the
 * rest of the tab's session, which defeats the point of "live."
 */
export function useRealtime(workspaceId: string | undefined) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!workspaceId) return;

    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws?workspaceId=${workspaceId}`);

      socket.onmessage = (raw) => {
        let json: unknown;
        try {
          json = JSON.parse(raw.data as string);
        } catch {
          return;
        }
        const parsed = realtimeEventSchema.safeParse(json);
        if (!parsed.success) return;
        const event = parsed.data;

        if (event.entity === "task" || event.entity === "status") {
          utils.task.list.invalidate({ listId: event.listId });
          if (event.entity === "task") {
            utils.task.get.invalidate({ taskId: event.id });
            utils.task.highlights.invalidate();
            // attachment.list is a separate query from task.get/task.list
            // (attachments-section.tsx, clips-section.tsx) — a new
            // attachment publishes a plain "task updated" event (see
            // attachment.ts's confirmUpload), so without this a second
            // viewer of the same task would never see it land.
            utils.attachment.list.invalidate({ taskId: event.id });
          }
          if (event.entity === "status") utils.status.list.invalidate({ listId: event.listId });
        } else if (event.entity === "comment") {
          utils.comment.list.invalidate({ taskId: event.taskId });
        } else if (event.entity === "checklist") {
          utils.checklist.list.invalidate({ taskId: event.taskId });
        } else if (event.entity === "hierarchy") {
          utils.hierarchy.tree.invalidate({ workspaceId: event.workspaceId });
        } else if (event.entity === "tag") {
          utils.tag.list.invalidate({ workspaceId: event.workspaceId });
        } else if (event.entity === "customFieldDef") {
          // Defs are workspace-scoped (a null listId def applies everywhere),
          // so there's no single listId to filter by — invalidate every
          // cached customField.defs.list query regardless of which list.
          utils.customField.defs.list.invalidate();
        } else if (event.entity === "customFieldValue") {
          utils.customField.values.listForTask.invalidate({ taskId: event.taskId });
        }
      };

      socket.onclose = () => {
        if (!stopped) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [workspaceId, utils]);
}
