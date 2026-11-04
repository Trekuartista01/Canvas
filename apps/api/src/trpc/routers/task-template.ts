import { db, schema } from "@canvas/db";
import {
  createTaskTemplateFromTaskSchema,
  deleteTaskTemplateSchema,
  instantiateTaskTemplateSchema,
  listTaskTemplatesSchema,
  taskTemplatePayloadSchema,
  type TaskTemplatePayload,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { nextOrderKey } from "../../lib/order";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import {
  firstStatusForList,
  lastTaskOrderKey,
  requireTask,
  workspaceIdForList,
  workspaceIdForTask,
  spaceIdForTask,
  spaceIdForList,
} from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

async function requireTemplate(templateId: string) {
  const template = await db.query.taskTemplates.findFirst({
    where: eq(schema.taskTemplates.id, templateId),
  });
  if (!template) throw new TRPCError({ code: "NOT_FOUND" });
  return template;
}

export const taskTemplateRouter = router({
  list: protectedProcedure.input(listTaskTemplatesSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "taskTemplate:view");

    return db
      .select()
      .from(schema.taskTemplates)
      .where(eq(schema.taskTemplates.workspaceId, input.workspaceId))
      .orderBy(asc(schema.taskTemplates.name));
  }),

  createFromTask: protectedProcedure
    .input(createTaskTemplateFromTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForTask(task.id);
      await assertCan(ctx.user, workspaceId, "taskTemplate:create", {
        spaceId: await spaceIdForTask(task.id),
      });

      const tags = await db
        .select({ tagId: schema.taskTags.tagId })
        .from(schema.taskTags)
        .where(eq(schema.taskTags.taskId, task.id));

      const checklists = await db.query.checklists.findMany({
        where: eq(schema.checklists.taskId, task.id),
        orderBy: asc(schema.checklists.orderKey),
      });
      const items =
        checklists.length > 0
          ? await db.query.checklistItems.findMany({
              where: inArray(
                schema.checklistItems.checklistId,
                checklists.map((c) => c.id),
              ),
              orderBy: asc(schema.checklistItems.orderKey),
            })
          : [];

      const payload: TaskTemplatePayload = {
        title: task.title,
        descriptionJson: task.descriptionJson ?? null,
        priority: task.priority,
        tagIds: tags.map((t) => t.tagId),
        checklists: checklists.map((c) => ({
          name: c.name,
          items: items.filter((i) => i.checklistId === c.id).map((i) => i.text),
        })),
      };

      const [template] = await db
        .insert(schema.taskTemplates)
        .values({ workspaceId, name: input.name, payloadJson: payload })
        .returning();
      if (!template) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        workspaceId,
        ctx.user.id,
        "task_template",
        template.id,
        "task_template.created",
        { fromTaskId: task.id },
      );
      return template;
    }),

  delete: protectedProcedure.input(deleteTaskTemplateSchema).mutation(async ({ ctx, input }) => {
    const template = await requireTemplate(input.templateId);
    await assertCan(ctx.user, template.workspaceId, "taskTemplate:delete");

    await db.delete(schema.taskTemplates).where(eq(schema.taskTemplates.id, template.id));

    await logActivity(
      template.workspaceId,
      ctx.user.id,
      "task_template",
      template.id,
      "task_template.deleted",
    );
    return { id: template.id };
  }),

  instantiate: protectedProcedure
    .input(instantiateTaskTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const template = await requireTemplate(input.templateId);
      const workspaceId = await workspaceIdForList(input.listId);
      if (workspaceId !== template.workspaceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Template does not belong to this workspace",
        });
      }
      await assertCan(ctx.user, workspaceId, "task:create", {
        spaceId: await spaceIdForList(input.listId),
      });

      const payload = taskTemplatePayloadSchema.parse(template.payloadJson);

      const status = await firstStatusForList(input.listId);
      const lastKey = await lastTaskOrderKey(input.listId, status.id);

      const [task] = await db
        .insert(schema.tasks)
        .values({
          listId: input.listId,
          title: payload.title,
          descriptionJson: payload.descriptionJson,
          statusId: status.id,
          priority: payload.priority,
          orderKey: nextOrderKey(lastKey),
          createdBy: ctx.user.id,
        })
        .returning();
      if (!task) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Only attach tags that still exist — a template can outlive a tag
      // it referenced (tags are hard-deleted, no fk-constraint failure to
      // catch this, so it's checked explicitly here).
      if (payload.tagIds.length > 0) {
        const existingTags = await db
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(
            and(eq(schema.tags.workspaceId, workspaceId), inArray(schema.tags.id, payload.tagIds)),
          );
        if (existingTags.length > 0) {
          await db
            .insert(schema.taskTags)
            .values(existingTags.map((t) => ({ taskId: task.id, tagId: t.id })));
        }
      }

      for (const checklist of payload.checklists) {
        const [createdChecklist] = await db
          .insert(schema.checklists)
          .values({ taskId: task.id, name: checklist.name, orderKey: nextOrderKey(null) })
          .returning();
        if (!createdChecklist) continue;

        let lastItemKey: string | null = null;
        for (const text of checklist.items) {
          lastItemKey = nextOrderKey(lastItemKey);
          await db
            .insert(schema.checklistItems)
            .values({ checklistId: createdChecklist.id, text, orderKey: lastItemKey });
        }
      }

      await logActivity(workspaceId, ctx.user.id, "task", task.id, "task.created_from_template", {
        templateId: template.id,
      });
      await publish(workspaceId, {
        entity: "task",
        id: task.id,
        listId: input.listId,
        kind: "created",
      });

      return task;
    }),
});
