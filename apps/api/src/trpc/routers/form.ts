import { db, schema } from "@canvas/db";
import {
  createFormSchema,
  deleteFormSchema,
  formSchemaSchema,
  getFormSchema,
  getPublicFormSchema,
  hasTitleField,
  listFormsSchema,
  submitPublicFormSchema,
  TITLE_FIELD_ID,
  updateFormSchema,
  type FormSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { buildTaskFromSubmission, validateFormSubmission } from "../../lib/form-submission";
import { requireList } from "../../lib/hierarchy";
import { nextOrderKey } from "../../lib/order";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import {
  assertPublicRateLimit,
  clientIp,
  PUBLIC_FORM_RATE_LIMIT_MAX,
  RateLimitError,
} from "../../lib/rate-limit";
import { completeTaskWithDefaultStatus } from "../../lib/task-completion";
import {
  firstStatusForList,
  lastTaskOrderKey,
  requireTask,
  workspaceIdForList,
} from "../../lib/task-queries";
import { isDoneKind } from "../../lib/task-update";
import { protectedProcedure, publicProcedure, router } from "../trpc";

async function requireForm(formId: string) {
  const form = await db.query.forms.findFirst({ where: eq(schema.forms.id, formId) });
  if (!form) throw new TRPCError({ code: "NOT_FOUND" });
  return form;
}

function parseFormSchema(schemaJson: unknown): FormSchema {
  return formSchemaSchema.parse(schemaJson);
}

function tooManyRequests(): never {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Too many attempts. Try again in a minute.",
  });
}

// Shared by create/update: a task must belong to the same workspace the
// form is (or already is) scoped to — same cross-workspace guard shape as
// the list check just below it.
async function requireTaskInWorkspace(taskId: string, workspaceId: string) {
  const task = await requireTask(taskId);
  const taskWorkspaceId = await workspaceIdForList(task.listId);
  if (taskWorkspaceId !== workspaceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Task does not belong to this workspace" });
  }
  return task;
}

export const formRouter = router({
  list: protectedProcedure.input(listFormsSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "form:view");

    return db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.workspaceId, input.workspaceId))
      .orderBy(asc(schema.forms.name));
  }),

  get: protectedProcedure.input(getFormSchema).query(async ({ ctx, input }) => {
    const form = await requireForm(input.formId);
    await assertCan(ctx.user, form.workspaceId, "form:view");
    return form;
  }),

  create: protectedProcedure.input(createFormSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "form:create");

    const list = await requireList(input.listId);
    // Cross-workspace guard, same shape as task-template.instantiate: resolve
    // the list's own workspace via its space and compare.
    const listSpace = await db.query.spaces.findFirst({
      where: eq(schema.spaces.id, list.spaceId),
    });
    if (!listSpace || listSpace.workspaceId !== input.workspaceId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "List does not belong to this workspace",
      });
    }

    if (input.taskId) await requireTaskInWorkspace(input.taskId, input.workspaceId);

    const schemaJson: FormSchema = parseFormSchema({ fields: input.fields });

    const [form] = await db
      .insert(schema.forms)
      .values({
        workspaceId: input.workspaceId,
        listId: input.listId,
        taskId: input.taskId ?? null,
        name: input.name,
        schemaJson,
        createdBy: ctx.user.id,
      })
      .returning();
    if (!form) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(input.workspaceId, ctx.user.id, "form", form.id, "form.created");
    return form;
  }),

  update: protectedProcedure.input(updateFormSchema).mutation(async ({ ctx, input }) => {
    const form = await requireForm(input.formId);
    await assertCan(ctx.user, form.workspaceId, "form:update");

    if (input.taskId) await requireTaskInWorkspace(input.taskId, form.workspaceId);

    // An intake-mode form (no bound task, either already or as of this
    // update) still needs its title field — formSchemaSchema itself no
    // longer enforces that (a completion-mode form legitimately has zero
    // fields), so it's checked here against the *resulting* mode instead.
    const resultingTaskId = input.taskId === undefined ? form.taskId : input.taskId;
    const schemaJson =
      input.fields !== undefined ? parseFormSchema({ fields: input.fields }) : undefined;
    if (schemaJson !== undefined && !resultingTaskId && !hasTitleField(schemaJson.fields)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `An intake form must include a "${TITLE_FIELD_ID}" field`,
      });
    }

    const [updated] = await db
      .update(schema.forms)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        ...(schemaJson !== undefined ? { schemaJson } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.forms.id, form.id))
      .returning();
    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(form.workspaceId, ctx.user.id, "form", form.id, "form.updated");
    return updated;
  }),

  delete: protectedProcedure.input(deleteFormSchema).mutation(async ({ ctx, input }) => {
    const form = await requireForm(input.formId);
    await assertCan(ctx.user, form.workspaceId, "form:delete");

    await db.delete(schema.forms).where(eq(schema.forms.id, form.id));

    await logActivity(form.workspaceId, ctx.user.id, "form", form.id, "form.deleted");
    return { id: form.id };
  }),

  // Public, unauthenticated surface — an external submitter never has a
  // session, so these two never call `assertCan`/`can` at all. Only what's
  // needed to render/submit the form is exposed; workspaceId/listId stay
  // server-side.
  getPublic: publicProcedure.input(getPublicFormSchema).query(async ({ ctx, input }) => {
    try {
      await assertPublicRateLimit(`form:ip:${clientIp(ctx.req)}`, PUBLIC_FORM_RATE_LIMIT_MAX);
    } catch (err) {
      if (err instanceof RateLimitError) tooManyRequests();
      throw err;
    }

    const form = await db.query.forms.findFirst({
      where: eq(schema.forms.publicToken, input.publicToken),
    });
    if (!form) throw new TRPCError({ code: "NOT_FOUND" });

    if (form.taskId) {
      const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, form.taskId) });
      // The linked task can be gone (hard-deleted) even though `taskId`
      // itself survives a soft-delete's normal path — `deleted_at` doesn't
      // save it from a workspace purge. Treat a missing task the same as
      // an invalid link rather than crash rendering the public page.
      if (!task || task.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });
      const status = await db.query.statuses.findFirst({
        where: eq(schema.statuses.id, task.statusId),
      });
      return {
        name: form.name,
        fields: [],
        taskId: form.taskId,
        task: {
          id: task.id,
          title: task.title,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          done: status ? isDoneKind(status.kind) : false,
        },
      };
    }

    const parsed = parseFormSchema(form.schemaJson);
    return { name: form.name, fields: parsed.fields, taskId: null, task: null };
  }),

  submitPublic: publicProcedure.input(submitPublicFormSchema).mutation(async ({ ctx, input }) => {
    // Two independent buckets: one IP hitting many forms, and one form
    // link being hammered from many (possibly rotating) IPs are both real
    // abuse shapes worth catching separately.
    try {
      await assertPublicRateLimit(`form:ip:${clientIp(ctx.req)}`, PUBLIC_FORM_RATE_LIMIT_MAX);
      await assertPublicRateLimit(`form:token:${input.publicToken}`, PUBLIC_FORM_RATE_LIMIT_MAX);
    } catch (err) {
      if (err instanceof RateLimitError) tooManyRequests();
      throw err;
    }

    const form = await db.query.forms.findFirst({
      where: eq(schema.forms.publicToken, input.publicToken),
    });
    if (!form) throw new TRPCError({ code: "NOT_FOUND" });

    if (form.taskId) {
      if (!input.submitterName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Your name is required" });
      }
      await completeTaskWithDefaultStatus(form.taskId, form.createdBy, {
        verb: "task.completed_via_form",
        extraPayload: { submitterName: input.submitterName, formId: form.id },
      });
      return { taskId: form.taskId, completed: true };
    }

    const parsed = parseFormSchema(form.schemaJson);
    const values = input.values ?? {};
    const errors = validateFormSubmission(parsed.fields, values);
    if (errors.length > 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: errors.join("; ") });
    }

    const { title, descriptionJson } = buildTaskFromSubmission(parsed.fields, values);
    const status = await firstStatusForList(form.listId);
    const lastKey = await lastTaskOrderKey(form.listId, status.id);

    const [task] = await db
      .insert(schema.tasks)
      .values({
        listId: form.listId,
        title,
        descriptionJson,
        statusId: status.id,
        orderKey: nextOrderKey(lastKey),
        createdBy: form.createdBy,
      })
      .returning();
    if (!task) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(form.workspaceId, form.createdBy, "task", task.id, "task.created_from_form", {
      formId: form.id,
    });
    await publish(form.workspaceId, {
      entity: "task",
      id: task.id,
      listId: task.listId,
      kind: "created",
    });

    return { taskId: task.id, completed: false };
  }),
});
