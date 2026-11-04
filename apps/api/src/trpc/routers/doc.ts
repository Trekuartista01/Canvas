import { spaceIdForTask } from "../../lib/task-queries";
import { db, schema } from "@canvas/db";
import {
  addDocTaskLinkSchema,
  createDocSchema,
  deleteDocSchema,
  getDocSchema,
  listDocsSchema,
  listDocTaskLinksSchema,
  removeDocTaskLinkSchema,
  updateDocSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { assertCan } from "../../lib/permissions";
import { requireTask, workspaceIdForTask } from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

async function requireDoc(docId: string) {
  const doc = await db.query.docs.findFirst({
    where: and(eq(schema.docs.id, docId), isNull(schema.docs.deletedAt)),
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
  return doc;
}

async function listLinksForDoc(docId: string) {
  return db
    .select({
      docId: schema.docTaskLinks.docId,
      taskId: schema.docTaskLinks.taskId,
      taskTitle: schema.tasks.title,
      createdAt: schema.docTaskLinks.createdAt,
    })
    .from(schema.docTaskLinks)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.docTaskLinks.taskId))
    .where(and(eq(schema.docTaskLinks.docId, docId), isNull(schema.tasks.deletedAt)))
    .orderBy(asc(schema.tasks.title));
}

export const docRouter = router({
  list: protectedProcedure.input(listDocsSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "doc:view");
    return db.query.docs.findMany({
      where: and(eq(schema.docs.workspaceId, input.workspaceId), isNull(schema.docs.deletedAt)),
      orderBy: asc(schema.docs.updatedAt),
      columns: {
        id: true,
        workspaceId: true,
        spaceId: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }),

  get: protectedProcedure.input(getDocSchema).query(async ({ ctx, input }) => {
    const doc = await requireDoc(input.docId);
    await assertCan(ctx.user, doc.workspaceId, "doc:view");
    return {
      id: doc.id,
      workspaceId: doc.workspaceId,
      spaceId: doc.spaceId,
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }),

  create: protectedProcedure.input(createDocSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "doc:create");
    const [doc] = await db
      .insert(schema.docs)
      .values({
        workspaceId: input.workspaceId,
        spaceId: input.spaceId ?? null,
        title: input.title,
      })
      .returning();
    if (!doc) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(input.workspaceId, ctx.user.id, "doc", doc.id, "doc.created");
    return {
      id: doc.id,
      workspaceId: doc.workspaceId,
      spaceId: doc.spaceId,
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }),

  update: protectedProcedure.input(updateDocSchema).mutation(async ({ ctx, input }) => {
    const doc = await requireDoc(input.docId);
    await assertCan(ctx.user, doc.workspaceId, "doc:update");
    const [updated] = await db
      .update(schema.docs)
      .set({ title: input.title, updatedAt: new Date() })
      .where(eq(schema.docs.id, doc.id))
      .returning();
    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(doc.workspaceId, ctx.user.id, "doc", doc.id, "doc.updated");
    return {
      id: updated.id,
      workspaceId: updated.workspaceId,
      spaceId: updated.spaceId,
      title: updated.title,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }),

  delete: protectedProcedure.input(deleteDocSchema).mutation(async ({ ctx, input }) => {
    const doc = await requireDoc(input.docId);
    await assertCan(ctx.user, doc.workspaceId, "doc:delete");
    await db
      .update(schema.docs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.docs.id, doc.id));
    await logActivity(doc.workspaceId, ctx.user.id, "doc", doc.id, "doc.deleted");
    return { id: doc.id };
  }),

  links: router({
    list: protectedProcedure.input(listDocTaskLinksSchema).query(async ({ ctx, input }) => {
      const doc = await requireDoc(input.docId);
      await assertCan(ctx.user, doc.workspaceId, "doc:view");
      return listLinksForDoc(doc.id);
    }),

    add: protectedProcedure.input(addDocTaskLinkSchema).mutation(async ({ ctx, input }) => {
      const doc = await requireDoc(input.docId);
      await assertCan(ctx.user, doc.workspaceId, "doc:update");
      const task = await requireTask(input.taskId);
      const taskWorkspaceId = await workspaceIdForTask(task.id);
      if (taskWorkspaceId !== doc.workspaceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Task does not belong to this workspace",
        });
      }
      await assertCan(ctx.user, doc.workspaceId, "task:view", {
        spaceId: await spaceIdForTask(input.taskId),
      });

      await db
        .insert(schema.docTaskLinks)
        .values({ docId: doc.id, taskId: task.id })
        .onConflictDoNothing();

      await logActivity(doc.workspaceId, ctx.user.id, "doc", doc.id, "doc.task_linked", {
        taskId: task.id,
      });
      return listLinksForDoc(doc.id);
    }),

    remove: protectedProcedure.input(removeDocTaskLinkSchema).mutation(async ({ ctx, input }) => {
      const doc = await requireDoc(input.docId);
      await assertCan(ctx.user, doc.workspaceId, "doc:update");

      await db
        .delete(schema.docTaskLinks)
        .where(
          and(eq(schema.docTaskLinks.docId, doc.id), eq(schema.docTaskLinks.taskId, input.taskId)),
        );

      await logActivity(doc.workspaceId, ctx.user.id, "doc", doc.id, "doc.task_unlinked", {
        taskId: input.taskId,
      });
      return listLinksForDoc(doc.id);
    }),
  }),
});
