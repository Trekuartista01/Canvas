import { db, schema } from "@canvas/db";
import { workspaceScopedSchema } from "@canvas/shared";
import { desc, eq } from "drizzle-orm";
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
    return db
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
  }),
});
