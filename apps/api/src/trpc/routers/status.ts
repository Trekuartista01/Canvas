import { db, schema } from "@canvas/db";
import {
  createStatusSchema,
  deleteStatusSchema,
  listStatusesSchema,
  updateStatusSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { requireList, requireSpace } from "../../lib/hierarchy";
import { nextOrderKey } from "../../lib/order";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import { protectedProcedure, router } from "../trpc";

async function requireStatus(statusId: string) {
  const status = await db.query.statuses.findFirst({ where: eq(schema.statuses.id, statusId) });
  if (!status) throw new TRPCError({ code: "NOT_FOUND" });
  return status;
}

async function lastStatusOrderKey(listId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.statuses.orderKey })
    .from(schema.statuses)
    .where(eq(schema.statuses.listId, listId))
    .orderBy(desc(schema.statuses.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

async function workspaceIdForList(listId: string) {
  const list = await requireList(listId);
  const space = await requireSpace(list.spaceId);
  return space.workspaceId;
}

async function spaceIdForList(listId: string) {
  const list = await requireList(listId);
  return list.spaceId;
}

export const statusRouter = router({
  list: protectedProcedure.input(listStatusesSchema).query(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForList(input.listId);
    await assertCan(ctx.user, workspaceId, "status:view", {
      spaceId: await spaceIdForList(input.listId),
    });

    return db
      .select()
      .from(schema.statuses)
      .where(eq(schema.statuses.listId, input.listId))
      .orderBy(asc(schema.statuses.orderKey));
  }),

  create: protectedProcedure.input(createStatusSchema).mutation(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForList(input.listId);
    const spaceId = await spaceIdForList(input.listId);
    await assertCan(ctx.user, workspaceId, "status:create", { spaceId });

    const lastKey = await lastStatusOrderKey(input.listId);

    const [status] = await db
      .insert(schema.statuses)
      .values({
        listId: input.listId,
        name: input.name,
        color: input.color,
        kind: input.kind,
        orderKey: nextOrderKey(lastKey),
      })
      .returning();
    if (!status) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(workspaceId, ctx.user.id, "status", status.id, "status.created");
    await publish(workspaceId, {
      entity: "status",
      id: status.id,
      listId: status.listId,
      kind: "created",
    });
    return status;
  }),

  update: protectedProcedure.input(updateStatusSchema).mutation(async ({ ctx, input }) => {
    const status = await requireStatus(input.statusId);
    const workspaceId = await workspaceIdForList(status.listId);
    const spaceId = await spaceIdForList(status.listId);
    await assertCan(ctx.user, workspaceId, "status:update", { spaceId });

    const [updated] = await db
      .update(schema.statuses)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.statuses.id, input.statusId))
      .returning();
    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(workspaceId, ctx.user.id, "status", status.id, "status.updated");
    await publish(workspaceId, {
      entity: "status",
      id: status.id,
      listId: status.listId,
      kind: "updated",
    });
    return updated;
  }),

  delete: protectedProcedure.input(deleteStatusSchema).mutation(async ({ ctx, input }) => {
    const status = await requireStatus(input.statusId);
    const workspaceId = await workspaceIdForList(status.listId);
    const spaceId = await spaceIdForList(status.listId);
    await assertCan(ctx.user, workspaceId, "status:delete", { spaceId });

    const [taskInStatus] = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.statusId, status.id), isNull(schema.tasks.deletedAt)))
      .limit(1);
    if (taskInStatus) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Move or delete every task in this status before deleting it",
      });
    }

    await db.delete(schema.statuses).where(eq(schema.statuses.id, status.id));

    await logActivity(workspaceId, ctx.user.id, "status", status.id, "status.deleted");
    await publish(workspaceId, {
      entity: "status",
      id: status.id,
      listId: status.listId,
      kind: "deleted",
    });
    return { id: status.id };
  }),
});
