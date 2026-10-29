import { db, schema } from "@canvas/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { can } from "../auth/can";
import { getSessionUser } from "../auth/session";
import { attachDocConnection, bufferEarlyMessages } from "../lib/doc-collab";
import { getMembershipRole } from "../lib/membership";

export function registerDocRealtimeRoutes(app: FastifyInstance) {
  // Client: WebsocketProvider(origin + '/ws/docs', docId, ydoc, { disableBc: true })
  // → ws://host/ws/docs/<docId>
  // Room name MUST be the doc id (not a shared "docs" string) so y-websocket's
  // BroadcastChannel key is per-document.
  app.get<{ Params: { docId: string } }>(
    "/ws/docs/:docId",
    { websocket: true },
    async (socket, req) => {
      // Before any await: the client's SyncStep1 can arrive while auth runs.
      const early = bufferEarlyMessages(socket);
      try {
        const user = await getSessionUser(req);
        const docId = req.params.docId;

        if (!user || !docId) {
          socket.close(4001, "Unauthorized");
          return;
        }

        const doc = await db.query.docs.findFirst({
          where: and(eq(schema.docs.id, docId), isNull(schema.docs.deletedAt)),
        });
        if (!doc) {
          socket.close(4001, "Unauthorized");
          return;
        }

        const role = await getMembershipRole(doc.workspaceId, user.id);
        if (!can(user, "doc:view", { type: "workspace", role })) {
          socket.close(4001, "Unauthorized");
          return;
        }

        await attachDocConnection(docId, socket, early);
      } catch (err) {
        console.error("[docs] WS handshake failed:", err);
        socket.close(1011, "Internal error");
      }
    },
  );
}
