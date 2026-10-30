import { db, schema } from "@canvas/db";
import { todayReportDate } from "@canvas/shared";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { logActivity } from "./activity";
import { findBalanceRow, getVacationBalance } from "./leave";
import { carryOverFrom } from "./leave-balance";
import { activeMembershipCondition } from "./membership";

/**
 * M7.5 year rollover: gives every active member a leave_balances row for the
 * current (Kosovo) year with carried_over_days = last year's unused vacation.
 * Runs on every scheduler tick; a member whose row for this year already has
 * carried_over_days set is skipped, so it does real work once per person per
 * year and is a single cheap query otherwise.
 *
 * Carry-over only comes from a year that was actually tracked — one with a
 * balance row (this job creates them). So the first year Canvas runs, and a
 * new hire's first year, carry nothing in rather than a phantom full
 * entitlement from before anyone recorded leave.
 */
export async function applyLeaveCarryOver(now = new Date()) {
  const year = Number(todayReportDate(now).slice(0, 4));

  const pending = await db
    .select({
      workspaceId: schema.memberships.workspaceId,
      userId: schema.memberships.userId,
    })
    .from(schema.memberships)
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .leftJoin(
      schema.leaveBalances,
      and(
        eq(schema.leaveBalances.workspaceId, schema.memberships.workspaceId),
        eq(schema.leaveBalances.userId, schema.memberships.userId),
        eq(schema.leaveBalances.year, year),
        isNotNull(schema.leaveBalances.carriedOverDays),
      ),
    )
    .where(and(activeMembershipCondition, isNull(schema.leaveBalances.id)));

  for (const member of pending) {
    const previousRow = await findBalanceRow(member.workspaceId, member.userId, year - 1);
    const carry = previousRow
      ? carryOverFrom(await getVacationBalance(member.workspaceId, member.userId, year - 1))
      : 0;

    const [row] = await db
      .insert(schema.leaveBalances)
      .values({
        workspaceId: member.workspaceId,
        userId: member.userId,
        year,
        carriedOverDays: carry,
      })
      .onConflictDoUpdate({
        target: [
          schema.leaveBalances.userId,
          schema.leaveBalances.workspaceId,
          schema.leaveBalances.year,
        ],
        // HR may have set this year's entitlement in advance — keep it, and
        // never overwrite a carry-over that's already there.
        set: { carriedOverDays: carry, updatedAt: new Date() },
        setWhere: isNull(schema.leaveBalances.carriedOverDays),
      })
      .returning();

    if (row && carry > 0) {
      await logActivity(
        member.workspaceId,
        member.userId,
        "leave_balance",
        row.id,
        "leave.carried_over",
        {
          year,
          days: carry,
        },
      );
    }
  }
}
