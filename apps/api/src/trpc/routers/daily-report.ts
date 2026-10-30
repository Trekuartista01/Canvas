import { db, schema } from "@canvas/db";
import {
  dailyReportIdSchema,
  dailyReportTeamSchema,
  effectivePeopleRole,
  saveDailyReportSchema,
  todayReportDate,
  workspaceScopedSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { SessionUser } from "../../auth/session";
import { logActivity } from "../../lib/activity";
import { activeMembershipCondition, getPeopleContext } from "../../lib/membership";
import { assertCanPeople, teamScopeFor } from "../../lib/permissions";
import { extractPlainText } from "../../lib/plain-text";
import { publish } from "../../lib/realtime";
import { protectedProcedure, router } from "../trpc";

async function requireActiveMember(user: SessionUser, workspaceId: string) {
  const people = await getPeopleContext(workspaceId, user.id);
  if (!people) throw new TRPCError({ code: "FORBIDDEN" });
  return people;
}

async function requireReport(reportId: string) {
  const report = await db.query.dailyReports.findFirst({
    where: eq(schema.dailyReports.id, reportId),
  });
  if (!report) throw new TRPCError({ code: "NOT_FOUND" });
  return report;
}

/** The author reads their own; anyone else needs report:viewTeam over the author. */
async function assertCanViewReport(
  user: SessionUser,
  report: { workspaceId: string; userId: string },
) {
  if (report.userId === user.id) {
    await requireActiveMember(user, report.workspaceId);
    return;
  }
  await assertCanPeople(user, report.workspaceId, "report:viewTeam", {
    targetUserId: report.userId,
  });
}

async function readCounts(reportIds: string[]) {
  if (reportIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ reportId: schema.dailyReportReads.reportId, reads: count() })
    .from(schema.dailyReportReads)
    .where(inArray(schema.dailyReportReads.reportId, reportIds))
    .groupBy(schema.dailyReportReads.reportId);
  return new Map(rows.map((r) => [r.reportId, r.reads]));
}

export const dailyReportRouter = router({
  // The caller's report for today (Kosovo date), if they've written one.
  today: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const reportDate = todayReportDate(new Date());
    const report = await db.query.dailyReports.findFirst({
      where: and(
        eq(schema.dailyReports.workspaceId, input.workspaceId),
        eq(schema.dailyReports.userId, ctx.user.id),
        eq(schema.dailyReports.reportDate, reportDate),
      ),
    });
    return { reportDate, report: report ?? null };
  }),

  // Submit, or edit today's report — only ever today's, so a report locks
  // at midnight Kosovo time without any job having to close it.
  save: protectedProcedure.input(saveDailyReportSchema).mutation(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    if (!extractPlainText(input.bodyJson).trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Write something before submitting" });
    }
    const reportDate = todayReportDate(new Date());
    const now = new Date();

    const existing = await db.query.dailyReports.findFirst({
      where: and(
        eq(schema.dailyReports.workspaceId, input.workspaceId),
        eq(schema.dailyReports.userId, ctx.user.id),
        eq(schema.dailyReports.reportDate, reportDate),
      ),
    });

    let report;
    if (existing) {
      [report] = await db
        .update(schema.dailyReports)
        .set({ bodyJson: input.bodyJson, updatedAt: now })
        .where(eq(schema.dailyReports.id, existing.id))
        .returning();
    } else {
      [report] = await db
        .insert(schema.dailyReports)
        .values({
          workspaceId: input.workspaceId,
          userId: ctx.user.id,
          reportDate,
          bodyJson: input.bodyJson,
        })
        // A double-click racing its own insert lands on the unique key.
        .onConflictDoUpdate({
          target: [
            schema.dailyReports.workspaceId,
            schema.dailyReports.userId,
            schema.dailyReports.reportDate,
          ],
          set: { bodyJson: input.bodyJson, updatedAt: now },
        })
        .returning();
    }
    if (!report) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(
      input.workspaceId,
      ctx.user.id,
      "daily_report",
      report.id,
      existing ? "daily_report.updated" : "daily_report.submitted",
      { reportDate },
    );
    await publish(input.workspaceId, {
      entity: "dailyReport",
      id: report.id,
      workspaceId: input.workspaceId,
      kind: existing ? "updated" : "created",
    });
    return report;
  }),

  // The caller's own history, newest first.
  mine: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const reports = await db
      .select({
        id: schema.dailyReports.id,
        reportDate: schema.dailyReports.reportDate,
        submittedAt: schema.dailyReports.submittedAt,
        updatedAt: schema.dailyReports.updatedAt,
      })
      .from(schema.dailyReports)
      .where(
        and(
          eq(schema.dailyReports.workspaceId, input.workspaceId),
          eq(schema.dailyReports.userId, ctx.user.id),
        ),
      )
      .orderBy(desc(schema.dailyReports.reportDate));
    const reads = await readCounts(reports.map((r) => r.id));
    return reports.map((r) => ({ ...r, readCount: reads.get(r.id) ?? 0 }));
  }),

  // Managers: who submitted on a date and who didn't. Staff are expected to
  // report; anyone else in scope shows up only if they did submit. A staff
  // manager sees only their direct reports.
  team: protectedProcedure.input(dailyReportTeamSchema).query(async ({ ctx, input }) => {
    const people = await assertCanPeople(ctx.user, input.workspaceId, "report:viewTeam");
    const scope = await teamScopeFor(input.workspaceId, ctx.user.id, people.peopleRole);

    const members = await db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
        role: schema.memberships.role,
        storedPeopleRole: schema.memberships.peopleRole,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .leftJoin(
        schema.employeeProfiles,
        eq(schema.employeeProfiles.membershipId, schema.memberships.id),
      )
      .where(
        and(
          eq(schema.memberships.workspaceId, input.workspaceId),
          activeMembershipCondition,
          scope
            ? inArray(schema.memberships.userId, scope.length ? scope : [ctx.user.id])
            : undefined,
        ),
      )
      .orderBy(asc(schema.users.name));

    const reports = await db
      .select({
        id: schema.dailyReports.id,
        userId: schema.dailyReports.userId,
        submittedAt: schema.dailyReports.submittedAt,
        updatedAt: schema.dailyReports.updatedAt,
      })
      .from(schema.dailyReports)
      .where(
        and(
          eq(schema.dailyReports.workspaceId, input.workspaceId),
          eq(schema.dailyReports.reportDate, input.reportDate),
        ),
      );
    const reportByUser = new Map(reports.map((r) => [r.userId, r]));
    const reads = await readCounts(reports.map((r) => r.id));

    return members
      .filter((m) => m.userId !== ctx.user.id)
      .map(({ storedPeopleRole, role, ...m }) => {
        const report = reportByUser.get(m.userId);
        return {
          ...m,
          peopleRole: effectivePeopleRole(role, storedPeopleRole),
          report: report ? { ...report, readCount: reads.get(report.id) ?? 0 } : null,
        };
      })
      .filter((m) => m.peopleRole === "staff" || m.report !== null);
  }),

  get: protectedProcedure.input(dailyReportIdSchema).query(async ({ ctx, input }) => {
    const report = await requireReport(input.reportId);
    await assertCanViewReport(ctx.user, report);
    const [author, readers] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, report.userId) }),
      db
        .select({
          userId: schema.users.id,
          name: schema.users.name,
          readAt: schema.dailyReportReads.readAt,
        })
        .from(schema.dailyReportReads)
        .innerJoin(schema.users, eq(schema.users.id, schema.dailyReportReads.userId))
        .where(eq(schema.dailyReportReads.reportId, report.id))
        .orderBy(asc(schema.dailyReportReads.readAt)),
    ]);
    return {
      ...report,
      authorName: author?.name ?? "",
      isMine: report.userId === ctx.user.id,
      editable: report.userId === ctx.user.id && report.reportDate === todayReportDate(new Date()),
      readers,
    };
  }),

  // Called when someone other than the author opens a report. Only the first
  // open counts (and gets an activity row).
  markRead: protectedProcedure.input(dailyReportIdSchema).mutation(async ({ ctx, input }) => {
    const report = await requireReport(input.reportId);
    await assertCanViewReport(ctx.user, report);
    if (report.userId === ctx.user.id) return { recorded: false };

    const inserted = await db
      .insert(schema.dailyReportReads)
      .values({ reportId: report.id, userId: ctx.user.id })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return { recorded: false };

    await logActivity(
      report.workspaceId,
      ctx.user.id,
      "daily_report",
      report.id,
      "daily_report.read",
      {
        reportDate: report.reportDate,
        authorId: report.userId,
      },
    );
    await publish(report.workspaceId, {
      entity: "dailyReport",
      id: report.id,
      workspaceId: report.workspaceId,
      kind: "updated",
    });
    return { recorded: true };
  }),
});
