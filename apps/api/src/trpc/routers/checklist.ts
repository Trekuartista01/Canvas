import { db, schema } from "@canvas/db";
import {
  createChecklistItemSchema,
  createChecklistSchema,
  deleteChecklistItemSchema,
  deleteChecklistSchema,
  listChecklistsSchema,
  updateChecklistItemSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { nextOrderKey } from "../../lib/order";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import { requireTask, workspaceIdForTask, spaceIdForTask } from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

async function requireChecklist(checklistId: string) {
  const checklist = await db.query.checklists.findFirst({
    where: eq(schema.checklists.id, checklistId),
  });
  if (!checklist) throw new TRPCError({ code: "NOT_FOUND" });
  return checklist;
}

async function requireChecklistItem(itemId: string) {
  const item = await db.query.checklistItems.findFirst({
    where: eq(schema.checklistItems.id, itemId),
  });
  if (!item) throw new TRPCError({ code: "NOT_FOUND" });
  return item;
}

async function lastChecklistOrderKey(taskId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.checklists.orderKey })
    .from(schema.checklists)
    .where(eq(schema.checklists.taskId, taskId))
    .orderBy(desc(schema.checklists.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

async function lastItemOrderKey(checklistId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.checklistItems.orderKey })
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.checklistId, checklistId))
    .orderBy(desc(schema.checklistItems.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

export const checklistRouter = router({
  list: protectedProcedure.input(listChecklistsSchema).query(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForTask(input.taskId);
    await assertCan(ctx.user, workspaceId, "task:view", {
      spaceId: await spaceIdForTask(input.taskId),
    });

    const checklists = await db.query.checklists.findMany({
      where: eq(schema.checklists.taskId, input.taskId),
      orderBy: asc(schema.checklists.orderKey),
    });
    if (checklists.length === 0) return [];

    const items = await db.query.checklistItems.findMany({
      where: inArray(
        schema.checklistItems.checklistId,
        checklists.map((c) => c.id),
      ),
      orderBy: asc(schema.checklistItems.orderKey),
    });

    return checklists.map((checklist) => ({
      ...checklist,
      items: items.filter((item) => item.checklistId === checklist.id),
    }));
  }),

  create: protectedProcedure.input(createChecklistSchema).mutation(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForTask(task.id);
    await assertCan(ctx.user, workspaceId, "task:update", {
      spaceId: await spaceIdForTask(task.id),
    });

    const lastKey = await lastChecklistOrderKey(task.id);
    const [checklist] = await db
      .insert(schema.checklists)
      .values({ taskId: task.id, name: input.name, orderKey: nextOrderKey(lastKey) })
      .returning();
    if (!checklist) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(workspaceId, ctx.user.id, "checklist", checklist.id, "checklist.created");
    await publish(workspaceId, {
      entity: "checklist",
      id: checklist.id,
      taskId: task.id,
      kind: "created",
    });
    return { ...checklist, items: [] as (typeof schema.checklistItems.$inferSelect)[] };
  }),

  delete: protectedProcedure.input(deleteChecklistSchema).mutation(async ({ ctx, input }) => {
    const checklist = await requireChecklist(input.checklistId);
    const workspaceId = await workspaceIdForTask(checklist.taskId);
    await assertCan(ctx.user, workspaceId, "task:update", {
      spaceId: await spaceIdForTask(checklist.taskId),
    });

    await db.delete(schema.checklists).where(eq(schema.checklists.id, checklist.id));

    await logActivity(workspaceId, ctx.user.id, "checklist", checklist.id, "checklist.deleted");
    await publish(workspaceId, {
      entity: "checklist",
      id: checklist.id,
      taskId: checklist.taskId,
      kind: "deleted",
    });
    return { id: checklist.id };
  }),

  items: router({
    create: protectedProcedure.input(createChecklistItemSchema).mutation(async ({ ctx, input }) => {
      const checklist = await requireChecklist(input.checklistId);
      const workspaceId = await workspaceIdForTask(checklist.taskId);
      await assertCan(ctx.user, workspaceId, "task:update", {
        spaceId: await spaceIdForTask(checklist.taskId),
      });

      const lastKey = await lastItemOrderKey(checklist.id);
      const [item] = await db
        .insert(schema.checklistItems)
        .values({
          checklistId: checklist.id,
          text: input.text,
          orderKey: nextOrderKey(lastKey),
        })
        .returning();
      if (!item) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        workspaceId,
        ctx.user.id,
        "checklist_item",
        item.id,
        "checklist_item.created",
      );
      await publish(workspaceId, {
        entity: "checklist",
        id: item.id,
        taskId: checklist.taskId,
        kind: "created",
      });
      return item;
    }),

    update: protectedProcedure.input(updateChecklistItemSchema).mutation(async ({ ctx, input }) => {
      const item = await requireChecklistItem(input.itemId);
      const checklist = await requireChecklist(item.checklistId);
      const workspaceId = await workspaceIdForTask(checklist.taskId);
      await assertCan(ctx.user, workspaceId, "task:update", {
        spaceId: await spaceIdForTask(checklist.taskId),
      });

      const [updated] = await db
        .update(schema.checklistItems)
        .set({
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.done !== undefined ? { done: input.done } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.checklistItems.id, item.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        workspaceId,
        ctx.user.id,
        "checklist_item",
        item.id,
        input.done !== undefined
          ? input.done
            ? "checklist_item.checked"
            : "checklist_item.unchecked"
          : "checklist_item.updated",
      );
      await publish(workspaceId, {
        entity: "checklist",
        id: item.id,
        taskId: checklist.taskId,
        kind: "updated",
      });
      return updated;
    }),

    delete: protectedProcedure.input(deleteChecklistItemSchema).mutation(async ({ ctx, input }) => {
      const item = await requireChecklistItem(input.itemId);
      const checklist = await requireChecklist(item.checklistId);
      const workspaceId = await workspaceIdForTask(checklist.taskId);
      await assertCan(ctx.user, workspaceId, "task:update", {
        spaceId: await spaceIdForTask(checklist.taskId),
      });

      await db.delete(schema.checklistItems).where(eq(schema.checklistItems.id, item.id));

      await logActivity(
        workspaceId,
        ctx.user.id,
        "checklist_item",
        item.id,
        "checklist_item.deleted",
      );
      await publish(workspaceId, {
        entity: "checklist",
        id: item.id,
        taskId: checklist.taskId,
        kind: "deleted",
      });
      return { id: item.id };
    }),
  }),
});
