import { db, schema } from "@canvas/db";
import {
  addDays,
  performanceEmployeeSchema,
  performanceRangeSchema,
  todayReportDate,
  workspaceScopedSchema,
} from "@canvas/shared";
import { and, desc, eq, gte } from "drizzle-orm";
import { can } from "../../auth/can";
import { getPeopleContext } from "../../lib/membership";
import { assertCanPeople, requireActiveMember, teamScopeFor } from "../../lib/permissions";
import {
  classifyTasks,
  completedOnTime,
  engagementStatus,
  previousMonth,
} from "../../lib/performance";
import {
  loadAssignedTasks,
  scopedMembers,
  type EomBreakdownEntry,
} from "../../lib/performance-data";
import { protectedProcedure, router } from "../trpc";

/** Monday-start weeks between from and to, for the completions chart. */
function weekStarts(from: string, to: string) {
  const starts: string[] = [];
  const first = new Date(`${from}T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  for (let d = addDays(from, -offset); d <= to; d = addDays(d, 7)) starts.push(d);
  return starts;
}

export const performanceRouter = router({
  // Per-employee summary for the range. A staff manager sees only their reports.
  team: protectedProcedure.input(performanceRangeSchema).query(async ({ ctx, input }) => {
    const people = await assertCanPeople(ctx.user, input.workspaceId, "performance:view");
    const scope = await teamScopeFor(input.workspaceId, ctx.user.id, people.peopleRole);
    const members = await scopedMembers(input.workspaceId, scope);
    const tasks = await loadAssignedTasks(
      input.workspaceId,
      members.map((m) => m.userId),
    );
    const now = new Date();
    return members.map((m) => ({
      ...m,
      ...classifyTasks(tasks.get(m.userId) ?? [], { from: input.from, to: input.to, now }).totals,
    }));
  }),

  // One employee: totals, weekly completions and their overdue tasks.
  employee: protectedProcedure.input(performanceEmployeeSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "performance:view", {
      targetUserId: input.userId,
    });
    const tasks =
      (await loadAssignedTasks(input.workspaceId, [input.userId])).get(input.userId) ?? [];
    const result = classifyTasks(tasks, { from: input.from, to: input.to, now: new Date() });
    const weeks = weekStarts(input.from, input.to).map((start) => ({ start, onTime: 0, late: 0 }));
    for (const t of tasks) {
      if (!t.completedAt) continue;
      const day = todayReportDate(t.completedAt);
      if (day < input.from || day > input.to) continue;
      const week = [...weeks].reverse().find((w) => w.start <= day);
      if (!week) continue;
      if (completedOnTime(t, t.completedAt)) week.onTime++;
      else week.late++;
    }
    return {
      totals: result.totals,
      weeks,
      overdueTasks: result.overdueTasks.map((t) => ({
        id: t.id,
        title: t.title,
        listId: t.listId,
        dueDate: t.dueDate,
        dueTime: t.dueTime,
      })),
    };
  }),

  // Live board: one card per active employee in scope.
  engagements: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    const people = await assertCanPeople(ctx.user, input.workspaceId, "report:viewTeam");
    const scope = await teamScopeFor(input.workspaceId, ctx.user.id, people.peopleRole);
    const members = await scopedMembers(input.workspaceId, scope);
    const open = await loadAssignedTasks(
      input.workspaceId,
      members.map((m) => m.userId),
      { openOnly: true },
    );
    const now = new Date();
    return members.map((m) => {
      const tasks = open.get(m.userId) ?? [];
      const inProgress = tasks
        .filter((t) => t.statusKind === "active" || t.statusKind === "review")
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
      return {
        ...m,
        openCount: tasks.length,
        inProgress: inProgress.map((t) => ({
          id: t.id,
          title: t.title,
          listId: t.listId,
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          statusKind: t.statusKind,
        })),
        ...engagementStatus(tasks, now),
      };
    });
  }),

  // The banner (everyone) and, for whole-workspace viewers, the ranking.
  employeeOfMonth: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const { month: lastMonth } = previousMonth(todayReportDate(new Date()));
    const [row] = await db
      .select()
      .from(schema.employeeOfMonth)
      .where(
        and(
          eq(schema.employeeOfMonth.workspaceId, input.workspaceId),
          gte(schema.employeeOfMonth.month, lastMonth),
        ),
      )
      .orderBy(desc(schema.employeeOfMonth.month))
      .limit(1);
    if (!row) return null;
    const breakdown = row.breakdownJson as {
      winner: EomBreakdownEntry | null;
      ranking: EomBreakdownEntry[];
    };
    const people = await getPeopleContext(input.workspaceId, ctx.user.id);
    // The whole ranking: people who see everyone's performance (not a staff
    // manager, whose view is limited to their own reports).
    const seesRanking =
      !!people &&
      people.peopleRole !== "staff_manager" &&
      can(ctx.user, "performance:view", { type: "people", peopleRole: people.peopleRole });
    const winner = row.userId
      ? await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) })
      : null;
    const [y, m] = row.month.split("-").map(Number) as [number, number];
    const following = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    return {
      month: row.month,
      winner: winner
        ? { userId: winner.id, name: winner.name, avatarUrl: winner.avatarUrl, ...breakdown.winner }
        : null,
      // Shown to admins on days 1–5 of the following month (checked in the UI).
      ranking: seesRanking ? breakdown.ranking : null,
      rankingVisibleFrom: `${following}-01`,
      rankingVisibleUntil: `${following}-05`,
    };
  }),
});
