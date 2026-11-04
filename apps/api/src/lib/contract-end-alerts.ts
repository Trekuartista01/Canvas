import { db, schema } from "@canvas/db";
import {
  contractMessages,
  isContractAlertDue,
  todayReportDate,
  type HolidayCalendar,
} from "@canvas/shared";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { emailUsers } from "../email/send-email";
import { env } from "../env";
import { logActivity } from "./activity";
import { activeMembershipCondition, listHrUserIds } from "./membership";
import { notifyUsers } from "./notify";
import { loadHolidayCalendar } from "./working-days";

/**
 * P8.6 (spec §6): every HR user hears, in-app and by email, on the last
 * working day before a contract ends. Runs on every scheduler tick and acts
 * from 08:00 Kosovo time; a server that was down on the alert day catches up
 * while the contract hasn't ended. Claiming end_alert_sent_at first is what
 * makes it go out once. Archived people get no alert.
 * `workspaceId` limits a run to one workspace (the e2e hook).
 */
export async function sendContractEndAlerts(now = new Date(), workspaceId?: string) {
  const today = todayReportDate(now);
  const pending = await db
    .select({
      id: schema.employmentContracts.id,
      workspaceId: schema.employmentContracts.workspaceId,
      userId: schema.employmentContracts.userId,
      title: schema.employmentContracts.title,
      endDate: schema.employmentContracts.expiryDate,
      employeeName: schema.users.name,
    })
    .from(schema.employmentContracts)
    .innerJoin(schema.users, eq(schema.users.id, schema.employmentContracts.userId))
    .innerJoin(
      schema.memberships,
      and(
        eq(schema.memberships.workspaceId, schema.employmentContracts.workspaceId),
        eq(schema.memberships.userId, schema.employmentContracts.userId),
      ),
    )
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .where(
      and(
        isNull(schema.employmentContracts.deletedAt),
        isNull(schema.employmentContracts.endAlertSentAt),
        isNotNull(schema.employmentContracts.expiryDate),
        gt(schema.employmentContracts.expiryDate, today),
        activeMembershipCondition,
        workspaceId ? eq(schema.employmentContracts.workspaceId, workspaceId) : undefined,
      ),
    );

  const calendars = new Map<string, HolidayCalendar>();
  for (const contract of pending) {
    const endDate = contract.endDate!;
    let calendar = calendars.get(contract.workspaceId);
    if (!calendar) {
      calendar = await loadHolidayCalendar(contract.workspaceId);
      calendars.set(contract.workspaceId, calendar);
    }
    if (!isContractAlertDue(now, endDate, calendar)) continue;

    // Left unclaimed with no HR user, so it still goes out once there is one.
    const recipients = await listHrUserIds(contract.workspaceId);
    if (recipients.length === 0) continue;

    const [claim] = await db
      .update(schema.employmentContracts)
      .set({ endAlertSentAt: now })
      .where(
        and(
          eq(schema.employmentContracts.id, contract.id),
          isNull(schema.employmentContracts.endAlertSentAt),
        ),
      )
      .returning({ id: schema.employmentContracts.id });
    if (!claim) continue;

    // Scheduler-sent: the employee is the activity's subject, so they're its actor.
    const activity = await logActivity(
      contract.workspaceId,
      contract.userId,
      "contract",
      contract.id,
      "contract.expiring",
      {
        userId: contract.userId,
        employeeName: contract.employeeName,
        title: contract.title,
        expiryDate: endDate,
      },
    );
    await notifyUsers(activity.id, recipients);

    const message = contractMessages.ending({ name: contract.employeeName, endDate });
    await emailUsers(
      recipients,
      message,
      [
        message,
        "",
        `${env.WEB_URL}/w/${contract.workspaceId}/contracts?person=${contract.userId}`,
      ].join("\n"),
    );
  }
}
