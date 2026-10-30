import { db, schema } from "@canvas/db";
import { expandHolidays, isHolidayNoticeDue, todayReportDate } from "@canvas/shared";
import { and, eq, inArray } from "drizzle-orm";
import { getEmailClient } from "../email";
import { logActivity } from "./activity";
import { listActiveMemberIds } from "./membership";
import { notifyUsers } from "./notify";
import { loadHolidayRows } from "./working-days";

function formatDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * M7.4: tells every active member of a workspace about a public holiday
 * `holiday_notice_days` days before the day off (0 turns it off) — in-app
 * and by email. Runs on every scheduler tick; the public_holiday_notices row
 * is claimed first, so each holiday is announced once per workspace.
 */
export async function sendHolidayNotices(now = new Date()) {
  const today = todayReportDate(now);
  const year = Number(today.slice(0, 4));
  const workspaces = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      noticeDays: schema.workspaces.holidayNoticeDays,
    })
    .from(schema.workspaces);

  const emailClient = getEmailClient();
  for (const workspace of workspaces) {
    if (workspace.noticeDays <= 0) continue;
    const rows = await loadHolidayRows(workspace.id);
    if (rows.length === 0) continue;

    // Next year too, so a notice for early January goes out in late December.
    const upcoming = [...expandHolidays(rows, year), ...expandHolidays(rows, year + 1)].filter(
      (o) => isHolidayNoticeDue(today, o.observedDate, workspace.noticeDays),
    );

    for (const holiday of upcoming) {
      const [claim] = await db
        .insert(schema.publicHolidayNotices)
        .values({
          workspaceId: workspace.id,
          holidayId: holiday.id,
          observedDate: holiday.observedDate,
        })
        .onConflictDoNothing()
        .returning();
      if (!claim) continue;

      // Scheduler-sent: attributed to the workspace owner (activity needs an actor).
      const owner = await db.query.memberships.findFirst({
        where: and(
          eq(schema.memberships.workspaceId, workspace.id),
          eq(schema.memberships.role, "owner"),
        ),
      });
      if (!owner) continue;

      const activity = await logActivity(
        workspace.id,
        owner.userId,
        "holiday",
        holiday.id,
        "holiday.upcoming",
        { name: holiday.name, date: holiday.date, observedDate: holiday.observedDate },
      );
      const memberIds = await listActiveMemberIds(workspace.id);
      await notifyUsers(activity.id, memberIds);

      const dayOff =
        holiday.observedDate === holiday.date
          ? formatDay(holiday.date)
          : `${formatDay(holiday.observedDate)} (in place of ${formatDay(holiday.date)})`;
      const recipients =
        memberIds.length > 0
          ? await db
              .select({ email: schema.users.email })
              .from(schema.users)
              .where(inArray(schema.users.id, memberIds))
          : [];
      for (const { email } of recipients) {
        try {
          await emailClient.send({
            to: email,
            subject: `Public holiday: ${holiday.name} — ${formatDay(holiday.observedDate)}`,
            text: [
              `${holiday.name} is coming up. Day off: ${dayOff}.`,
              "",
              `— ${workspace.name}`,
            ].join("\n"),
          });
        } catch (err) {
          console.error(`[scheduler] holiday notice email to ${email} failed:`, err);
        }
      }
    }
  }
}
