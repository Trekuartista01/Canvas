import { db, schema } from "@canvas/db";
import {
  createCustomFieldDefSchema,
  deleteCustomFieldDefSchema,
  listCustomFieldDefsSchema,
  listCustomFieldValuesSchema,
  setCustomFieldValueSchema,
  updateCustomFieldDefSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { validateCustomFieldOptions, validateCustomFieldValue } from "../../lib/custom-field-value";
import { nextOrderKey } from "../../lib/order";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import { requireTask, workspaceIdForList, spaceIdForList } from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

async function requireFieldDef(fieldDefId: string) {
  const def = await db.query.customFieldDefs.findFirst({
    where: eq(schema.customFieldDefs.id, fieldDefId),
  });
  if (!def) throw new TRPCError({ code: "NOT_FOUND" });
  return def;
}

async function defsForList(listId: string, workspaceId: string) {
  return db
    .select()
    .from(schema.customFieldDefs)
    .where(
      and(
        eq(schema.customFieldDefs.workspaceId, workspaceId),
        or(isNull(schema.customFieldDefs.listId), eq(schema.customFieldDefs.listId, listId)),
      ),
    )
    .orderBy(asc(schema.customFieldDefs.orderKey));
}

async function lastDefOrderKey(workspaceId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.customFieldDefs.orderKey })
    .from(schema.customFieldDefs)
    .where(eq(schema.customFieldDefs.workspaceId, workspaceId))
    .orderBy(desc(schema.customFieldDefs.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

export const customFieldRouter = router({
  defs: router({
    list: protectedProcedure.input(listCustomFieldDefsSchema).query(async ({ ctx, input }) => {
      const workspaceId = await workspaceIdForList(input.listId);
      await assertCan(ctx.user, workspaceId, "customFieldDef:view", {
        spaceId: await spaceIdForList(input.listId),
      });

      return defsForList(input.listId, workspaceId);
    }),

    create: protectedProcedure
      .input(createCustomFieldDefSchema)
      .mutation(async ({ ctx, input }) => {
        await assertCan(ctx.user, input.workspaceId, "customFieldDef:create");

        const optionsError = validateCustomFieldOptions(input.type, input.optionsJson);
        if (optionsError) throw new TRPCError({ code: "BAD_REQUEST", message: optionsError });

        const lastKey = await lastDefOrderKey(input.workspaceId);
        const [def] = await db
          .insert(schema.customFieldDefs)
          .values({
            workspaceId: input.workspaceId,
            listId: input.listId,
            name: input.name,
            type: input.type,
            optionsJson: input.optionsJson,
            orderKey: nextOrderKey(lastKey),
          })
          .returning();
        if (!def) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await logActivity(
          input.workspaceId,
          ctx.user.id,
          "custom_field_def",
          def.id,
          "custom_field_def.created",
        );
        await publish(input.workspaceId, {
          entity: "customFieldDef",
          id: def.id,
          workspaceId: input.workspaceId,
          kind: "created",
        });
        return def;
      }),

    update: protectedProcedure
      .input(updateCustomFieldDefSchema)
      .mutation(async ({ ctx, input }) => {
        const def = await requireFieldDef(input.fieldDefId);
        await assertCan(ctx.user, def.workspaceId, "customFieldDef:update");

        if (input.optionsJson !== undefined) {
          const optionsError = validateCustomFieldOptions(def.type, input.optionsJson);
          if (optionsError) throw new TRPCError({ code: "BAD_REQUEST", message: optionsError });
        }

        const [updated] = await db
          .update(schema.customFieldDefs)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.optionsJson !== undefined ? { optionsJson: input.optionsJson } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.customFieldDefs.id, def.id))
          .returning();
        if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        await logActivity(
          def.workspaceId,
          ctx.user.id,
          "custom_field_def",
          def.id,
          "custom_field_def.updated",
        );
        await publish(def.workspaceId, {
          entity: "customFieldDef",
          id: def.id,
          workspaceId: def.workspaceId,
          kind: "updated",
        });
        return updated;
      }),

    delete: protectedProcedure
      .input(deleteCustomFieldDefSchema)
      .mutation(async ({ ctx, input }) => {
        const def = await requireFieldDef(input.fieldDefId);
        await assertCan(ctx.user, def.workspaceId, "customFieldDef:delete");

        await db.delete(schema.customFieldDefs).where(eq(schema.customFieldDefs.id, def.id));

        await logActivity(
          def.workspaceId,
          ctx.user.id,
          "custom_field_def",
          def.id,
          "custom_field_def.deleted",
        );
        await publish(def.workspaceId, {
          entity: "customFieldDef",
          id: def.id,
          workspaceId: def.workspaceId,
          kind: "deleted",
        });
        return { id: def.id };
      }),
  }),

  values: router({
    listForTask: protectedProcedure
      .input(listCustomFieldValuesSchema)
      .query(async ({ ctx, input }) => {
        const task = await requireTask(input.taskId);
        const workspaceId = await workspaceIdForList(task.listId);
        await assertCan(ctx.user, workspaceId, "customFieldDef:view", {
          spaceId: await spaceIdForList(task.listId),
        });

        const defs = await defsForList(task.listId, workspaceId);
        if (defs.length === 0) return [];

        const values = await db.query.customFieldValues.findMany({
          where: eq(schema.customFieldValues.taskId, task.id),
        });
        const valueByDefId = new Map(values.map((v) => [v.fieldDefId, v.valueJson]));

        return defs.map((def) => ({ ...def, value: valueByDefId.get(def.id) ?? null }));
      }),

    set: protectedProcedure.input(setCustomFieldValueSchema).mutation(async ({ ctx, input }) => {
      const task = await requireTask(input.taskId);
      const workspaceId = await workspaceIdForList(task.listId);
      await assertCan(ctx.user, workspaceId, "customFieldValue:update", {
        spaceId: await spaceIdForList(task.listId),
      });

      const def = await requireFieldDef(input.fieldDefId);
      if (def.workspaceId !== workspaceId || (def.listId && def.listId !== task.listId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This field does not apply to this task",
        });
      }

      if (input.valueJson === null) {
        await db
          .delete(schema.customFieldValues)
          .where(
            and(
              eq(schema.customFieldValues.fieldDefId, def.id),
              eq(schema.customFieldValues.taskId, task.id),
            ),
          );
        await logActivity(
          workspaceId,
          ctx.user.id,
          "custom_field_value",
          def.id,
          "custom_field_value.cleared",
        );
        await publish(workspaceId, {
          entity: "customFieldValue",
          id: def.id,
          taskId: task.id,
          kind: "deleted",
        });
        return { fieldDefId: def.id, taskId: task.id, value: null };
      }

      const valueError = validateCustomFieldValue(def.type, input.valueJson, def.optionsJson);
      if (valueError) throw new TRPCError({ code: "BAD_REQUEST", message: valueError });

      await db
        .insert(schema.customFieldValues)
        .values({ fieldDefId: def.id, taskId: task.id, valueJson: input.valueJson })
        .onConflictDoUpdate({
          target: [schema.customFieldValues.fieldDefId, schema.customFieldValues.taskId],
          set: { valueJson: input.valueJson, updatedAt: new Date() },
        });

      await logActivity(
        workspaceId,
        ctx.user.id,
        "custom_field_value",
        def.id,
        "custom_field_value.set",
      );
      await publish(workspaceId, {
        entity: "customFieldValue",
        id: def.id,
        taskId: task.id,
        kind: "updated",
      });
      return { fieldDefId: def.id, taskId: task.id, value: input.valueJson };
    }),
  }),
});
