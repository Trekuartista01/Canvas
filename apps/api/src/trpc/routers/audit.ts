import { db, schema } from "@canvas/db";
import { workspaceScopedSchema } from "@canvas/shared";
import { desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { assertCanPeople } from "../../lib/permissions";
import { protectedProcedure, router } from "../trpc";

export const auditRouter = router({
  // P8.1: the HR access log — who viewed, downloaded or changed HR data, and
  // every role change. hr:audit is hr_finance's alone (no admin bypass).
  list: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "hr:audit");
    const actor = alias(schema.users, "actor");
    const subject = alias(schema.users, "subject");
    const rows = await db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        entity: schema.auditLog.entity,
        entityId: schema.auditLog.entityId,
        ip: schema.auditLog.ip,
        payload: schema.auditLog.payloadJson,
        createdAt: schema.auditLog.createdAt,
        actorName: actor.name,
        // Most HR entries are about one person (entity_id is their user id).
        subjectName: subject.name,
      })
      .from(schema.auditLog)
      .leftJoin(actor, eq(actor.id, schema.auditLog.actorId))
      .leftJoin(subject, eq(subject.id, schema.auditLog.entityId))
      .where(eq(schema.auditLog.workspaceId, input.workspaceId))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(2000);

    // Contract entries point at the contract; the person is in the payload.
    const payloadOf = (payload: unknown) =>
      (payload ?? {}) as { userId?: unknown; fields?: unknown; format?: unknown; query?: unknown };
    const missing = [
      ...new Set(
        rows
          .filter((r) => !r.subjectName)
          .map((r) => payloadOf(r.payload).userId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const people =
      missing.length > 0
        ? await db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, missing))
        : [];
    const nameOf = new Map(people.map((p) => [p.id, p.name]));

    return rows.map(({ payload, subjectName, ...r }) => {
      const p = payloadOf(payload);
      return {
        ...r,
        subjectName:
          subjectName ?? (typeof p.userId === "string" ? (nameOf.get(p.userId) ?? null) : null),
        fields: Array.isArray(p.fields) ? (p.fields as string[]) : null,
        format: typeof p.format === "string" ? p.format : null,
        query: typeof p.query === "string" ? p.query : null,
      };
    });
  }),
});
