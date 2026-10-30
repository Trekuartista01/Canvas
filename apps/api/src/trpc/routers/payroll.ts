import { db, schema } from "@canvas/db";
import { payrollMemberSchema, upsertPayrollSchema, workspaceScopedSchema } from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { getMembershipRole } from "../../lib/membership";
import { encryptPayrollField, loadPayrollRows } from "../../lib/payroll";
import { assertCanPeople, requireActiveMember } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import { protectedProcedure, router } from "../trpc";

/**
 * M7.7 payroll — HR and super admins only (payroll:view / payroll:manage);
 * managers and staff never reach these procedures, apart from `mine`.
 *
 * Audit trail: every read of payroll data (list, a person's record, your
 * own record) and every edit writes an activity row — including the reads
 * done by queries, since who looked at payroll is exactly what the trail is
 * for. Activity payloads carry who/what, never any value.
 */
async function audit(workspaceId: string, actorId: string, verb: string, payload: object) {
  await logActivity(workspaceId, actorId, "payroll", workspaceId, verb, payload);
}

export const payrollRouter = router({
  // The table: ID-card numbers and IBANs masked to the last 4.
  list: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "payroll:view");
    const rows = await loadPayrollRows(input.workspaceId, { reveal: false });
    await audit(input.workspaceId, ctx.user.id, "payroll.list_viewed", { rows: rows.length });
    return rows;
  }),

  // The edit drawer: one person's record in full.
  get: protectedProcedure.input(payrollMemberSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "payroll:view", {
      targetUserId: input.userId,
    });
    const [row] = await loadPayrollRows(input.workspaceId, { reveal: true, userId: input.userId });
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await audit(input.workspaceId, ctx.user.id, "payroll.viewed", { userId: input.userId });
    return row;
  }),

  upsert: protectedProcedure.input(upsertPayrollSchema).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Someone else has to change your own payroll record",
      });
    }
    await assertCanPeople(ctx.user, input.workspaceId, "payroll:manage", {
      targetUserId: input.userId,
    });
    if (!(await getMembershipRole(input.workspaceId, input.userId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Not an active member" });
    }

    const { workspaceId, userId } = input;
    const secret = (field: "idCardNumber" | "iban", value: string | null | undefined) =>
      value === undefined
        ? undefined
        : value === null
          ? null
          : encryptPayrollField(workspaceId, userId, field, value);
    const values = {
      ...(input.netSalaryEur !== undefined ? { netSalaryEur: input.netSalaryEur } : {}),
      ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
      ...(input.accountHolder !== undefined ? { accountHolder: input.accountHolder } : {}),
      ...(input.idCardNumber !== undefined
        ? { idCardNumberEnc: secret("idCardNumber", input.idCardNumber) }
        : {}),
      ...(input.iban !== undefined ? { ibanEnc: secret("iban", input.iban) } : {}),
      updatedBy: ctx.user.id,
      updatedAt: new Date(),
    };
    const [record] = await db
      .insert(schema.payrollRecords)
      .values({ workspaceId, userId, ...values })
      .onConflictDoUpdate({
        target: [schema.payrollRecords.workspaceId, schema.payrollRecords.userId],
        set: values,
      })
      .returning({ id: schema.payrollRecords.id });
    if (!record) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Which fields changed — never what they changed to.
    const fields = (
      ["netSalaryEur", "idCardNumber", "bankName", "iban", "accountHolder"] as const
    ).filter((f) => input[f] !== undefined);
    await audit(workspaceId, ctx.user.id, "payroll.updated", { userId, fields });
    await publish(workspaceId, { entity: "payroll", id: record.id, workspaceId, kind: "updated" });
    return { id: record.id };
  }),

  // Any employee: their own pay details, ID card and IBAN masked to the last 4.
  mine: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const [row] = await loadPayrollRows(input.workspaceId, { reveal: false, userId: ctx.user.id });
    await audit(input.workspaceId, ctx.user.id, "payroll.self_viewed", { userId: ctx.user.id });
    return row?.recordId
      ? {
          netSalaryEur: row.netSalaryEur,
          bankName: row.bankName,
          accountHolder: row.accountHolder,
          idCardNumber: row.idCardNumber,
          iban: row.iban,
          updatedAt: row.updatedAt,
        }
      : null;
  }),

  // The audit trail itself: who viewed, changed or exported payroll.
  audit: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "payroll:view");
    const rows = await db
      .select({
        id: schema.activity.id,
        verb: schema.activity.verb,
        payload: schema.activity.payloadJson,
        createdAt: schema.activity.createdAt,
        actorName: schema.users.name,
      })
      .from(schema.activity)
      .innerJoin(schema.users, eq(schema.users.id, schema.activity.actorId))
      .where(
        and(
          eq(schema.activity.workspaceId, input.workspaceId),
          like(schema.activity.verb, "payroll.%"),
        ),
      )
      .orderBy(desc(schema.activity.createdAt))
      .limit(2000);
    const subjectIds = [
      ...new Set(
        rows
          .map((r) => (r.payload as { userId?: unknown } | null)?.userId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const subjects =
      subjectIds.length > 0
        ? await db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, subjectIds))
        : [];
    const nameOf = new Map(subjects.map((s) => [s.id, s.name]));
    return rows.map(({ payload, ...r }) => {
      const p = (payload ?? {}) as {
        userId?: string;
        fields?: string[];
        format?: string;
        rows?: number;
      };
      return {
        ...r,
        subjectName: p.userId ? (nameOf.get(p.userId) ?? null) : null,
        fields: p.fields ?? null,
        format: p.format ?? null,
        rowCount: p.rows ?? null,
      };
    });
  }),
});
