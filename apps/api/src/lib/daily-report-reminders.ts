import { db, schema } from "@canvas/db";
import { isReminderDue } from "@canvas/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getEmailClient } from "../email";
import { env } from "../env";
import { logActivity } from "./activity";
import { activeMembershipCondition } from "./membership";
import { notifyUsers } from "./notify";

/**
 * M7.3: from 16:45 Kosovo time on working days, reminds every active staff
 * member who hasn't submitted today's daily report — in-app and by email.
 * Runs on every scheduler tick; the daily_report_reminders row is claimed
 * before anything is sent, so each person is reminded at most once a day
 * however many ticks (or workers) see them.
 *
 * Holidays: isReminderDue takes an isHoliday hook — M7.4 plugs the Kosovo
 * holiday calendar in here.
 */
export async function sendDailyReportReminders(now = new Date()) {
  const { due, reportDate } = isReminderDue(now);
  if (!due) return;

  const pending = await db
    .select({
      workspaceId: schema.memberships.workspaceId,
      workspaceName: schema.workspaces.name,
      userId: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .leftJoin(
      schema.dailyReports,
      and(
        eq(schema.dailyReports.workspaceId, schema.memberships.workspaceId),
        eq(schema.dailyReports.userId, schema.memberships.userId),
        eq(schema.dailyReports.reportDate, reportDate),
      ),
    )
    .leftJoin(
      schema.dailyReportReminders,
      and(
        eq(schema.dailyReportReminders.workspaceId, schema.memberships.workspaceId),
        eq(schema.dailyReportReminders.userId, schema.memberships.userId),
        eq(schema.dailyReportReminders.reportDate, reportDate),
      ),
    )
    .where(
      and(
        activeMembershipCondition,
        // The owner is always super admin, whatever is stored (effectivePeopleRole).
        eq(schema.memberships.peopleRole, "staff"),
        ne(schema.memberships.role, "owner"),
        isNull(schema.dailyReports.id),
        isNull(schema.dailyReportReminders.id),
      ),
    );

  const emailClient = getEmailClient();
  for (const person of pending) {
    const [claim] = await db
      .insert(schema.dailyReportReminders)
      .values({ workspaceId: person.workspaceId, userId: person.userId, reportDate })
      .onConflictDoNothing()
      .returning();
    if (!claim) continue;

    // The reminder is about the person's own report, so they're its actor.
    const activity = await logActivity(
      person.workspaceId,
      person.userId,
      "daily_report_reminder",
      claim.id,
      "daily_report.reminder",
      { reportDate },
    );
    await notifyUsers(activity.id, [person.userId]);

    try {
      await emailClient.send({
        to: person.email,
        subject: `Reminder: today's daily report (${person.workspaceName})`,
        text: [
          "You haven't submitted your daily report for today yet.",
          "",
          `Write it here: ${env.WEB_URL}/w/${person.workspaceId}/daily-report`,
          "",
          "You can edit it until midnight.",
        ].join("\n"),
      });
    } catch (err) {
      // The in-app reminder already went out; one bad address mustn't stop the rest.
      console.error(`[scheduler] daily report reminder email to ${person.userId} failed:`, err);
    }
  }
}
