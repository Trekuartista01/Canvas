import { db, schema } from "@canvas/db";
import { todayReportDate } from "@canvas/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { logActivity } from "./activity";
import { activeMembershipCondition } from "./membership";
import {
  classifyTasks,
  monthRange,
  previousMonth,
  rankEmployeeOfMonth,
  type PerfTask,
} from "./performance";

export type PerfTaskRow = PerfTask & { listId: string };

/** Active members, optionally limited to `scope` (a staff manager's reports). */
export async function scopedMembers(workspaceId: string, scope: string[] | null) {
  if (scope && scope.length === 0) return [];
  return db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      jobTitle: schema.employeeProfiles.jobTitle,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        activeMembershipCondition,
        scope ? inArray(schema.memberships.userId, scope) : undefined,
      ),
    )
    .orderBy(asc(schema.users.name));
}

/**
 * Every live task (and subtask) assigned to each of `userIds` in this
 * workspace — tasks in deleted lists/spaces don't count. `openOnly` skips
 * finished ones (the engagements board).
 */
export async function loadAssignedTasks(
  workspaceId: string,
  userIds: string[],
  opts: { openOnly?: boolean } = {},
): Promise<Map<string, PerfTaskRow[]>> {
  const byUser = new Map<string, PerfTaskRow[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return byUser;
  const rows = await db
    .select({
      userId: schema.taskAssignees.userId,
      id: schema.tasks.id,
      title: schema.tasks.title,
      listId: schema.tasks.listId,
      dueDate: schema.tasks.dueDate,
      dueTime: schema.tasks.dueTime,
      completedAt: schema.tasks.completedAt,
      createdAt: schema.tasks.createdAt,
      statusKind: schema.statuses.kind,
    })
    .from(schema.tasks)
    .innerJoin(schema.taskAssignees, eq(schema.taskAssignees.taskId, schema.tasks.id))
    .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
    .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
    .where(
      and(
        eq(schema.spaces.workspaceId, workspaceId),
        inArray(schema.taskAssignees.userId, userIds),
        isNull(schema.tasks.deletedAt),
        isNull(schema.lists.deletedAt),
        isNull(schema.spaces.deletedAt),
        opts.openOnly ? isNull(schema.tasks.completedAt) : undefined,
      ),
    );
  for (const { userId, ...task } of rows) byUser.get(userId)?.push(task);
  return byUser;
}

export interface EomBreakdownEntry {
  userId: string;
  name: string;
  score: number;
  qualified: boolean;
  completedOnTime: number;
  completedLate: number;
  overdue: number;
  lastCompletedAt: string | null;
}

/**
 * Ranks every active member for `month` ("YYYY-MM") and stores the result.
 * With `replace` (the e2e test hook only) an existing row is recomputed;
 * otherwise a month that's already stored is left alone.
 */
export async function computeEmployeeOfMonth(
  workspaceId: string,
  month: string,
  opts: { replace?: boolean; now?: Date } = {},
) {
  const { from, to } = monthRange(month);
  const members = await scopedMembers(workspaceId, null);
  const tasks = await loadAssignedTasks(
    workspaceId,
    members.map((m) => m.userId),
  );
  const nameOf = new Map(members.map((m) => [m.userId, m.name]));
  const ranked = rankEmployeeOfMonth(
    members.map((m) => {
      const { totals, lastCompletedAt } = classifyTasks(tasks.get(m.userId) ?? [], {
        from,
        to,
        now: opts.now ?? new Date(),
      });
      return {
        userId: m.userId,
        completedOnTime: totals.completedOnTime,
        completedLate: totals.completedLate,
        overdue: totals.overdue,
        lastCompletedAt,
      };
    }),
  );
  const ranking: EomBreakdownEntry[] = ranked
    .filter((r) => r.completedOnTime + r.completedLate + r.overdue > 0)
    .map((r) => ({
      userId: r.userId,
      name: nameOf.get(r.userId) ?? "",
      score: r.score,
      qualified: r.qualified,
      completedOnTime: r.completedOnTime,
      completedLate: r.completedLate,
      overdue: r.overdue,
      lastCompletedAt: r.lastCompletedAt?.toISOString() ?? null,
    }));
  const winner = ranking.find((r) => r.qualified) ?? null;

  if (opts.replace) {
    await db
      .delete(schema.employeeOfMonth)
      .where(
        and(
          eq(schema.employeeOfMonth.workspaceId, workspaceId),
          eq(schema.employeeOfMonth.month, month),
        ),
      );
  }
  const [row] = await db
    .insert(schema.employeeOfMonth)
    .values({
      workspaceId,
      month,
      userId: winner?.userId ?? null,
      score: winner?.score ?? null,
      breakdownJson: { winner, ranking },
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;

  if (winner) {
    await logActivity(
      workspaceId,
      winner.userId,
      "employee_of_month",
      row.id,
      "employee_of_month.awarded",
      {
        month,
        userId: winner.userId,
        score: winner.score,
      },
    );
  }
  return row;
}

/**
 * Scheduler tick: from the 1st of each month (Kosovo date), every workspace
 * without a result for last month gets one — once, since the row's unique
 * (workspace, month) key stops a second computation.
 */
export async function runEmployeeOfMonth(now = new Date()) {
  const { month } = previousMonth(todayReportDate(now));
  const pending = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .leftJoin(
      schema.employeeOfMonth,
      and(
        eq(schema.employeeOfMonth.workspaceId, schema.workspaces.id),
        eq(schema.employeeOfMonth.month, month),
      ),
    )
    .where(isNull(schema.employeeOfMonth.id));
  for (const workspace of pending) await computeEmployeeOfMonth(workspace.id, month, { now });
}
