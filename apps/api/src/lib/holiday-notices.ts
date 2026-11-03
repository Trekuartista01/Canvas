import { db, schema } from "@canvas/db";
import {
  addDays,
  holidaysMissingFor,
  isHolidayNoticeDue,
  isWeekend,
  todayReportDate,
} from "@canvas/shared";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { getEmailClient } from "../email";
import { logActivity } from "./activity";
import { listActiveMemberIds, listHrUserIds } from "./membership";
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

// Scheduler-sent notices are attributed to the workspace owner (activity needs an actor).
async function workspaceOwnerId(workspaceId: string) {
  const owner = await db.query.memberships.findFirst({
    where: and(
      eq(schema.memberships.workspaceId, workspaceId),
      eq(schema.memberships.role, "owner"),
    ),
  });
  return owner?.userId ?? null;
}

/**
 * M7.4: tells every active member of a workspace about a public holiday
 * `holiday_notice_days` days before the day off (0 turns it off) — in-app
 * and by email. Runs on every scheduler tick; the public_holiday_notices row
 * is claimed first, so each holiday is announced once per workspace.
 * P8.2: every row is a concrete day off; one on a weekend isn't announced
 * (its substitute Monday, if there is one, is a row of its own).
 */
export async function sendHolidayNotices(now = new Date()) {
  const today = todayReportDate(now);
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
    const rows = await db
      .select({
        id: schema.publicHolidays.id,
        date: schema.publicHolidays.date,
        name: schema.publicHolidays.nameEn,
        isObservedSubstitute: schema.publicHolidays.isObservedSubstitute,
      })
      .from(schema.publicHolidays)
      .where(
        and(
          eq(schema.publicHolidays.workspaceId, workspace.id),
          isNull(schema.publicHolidays.deletedAt),
          gte(schema.publicHolidays.date, today),
          lte(schema.publicHolidays.date, addDays(today, workspace.noticeDays)),
        ),
      );
    const upcoming = rows.filter(
      (h) => !isWeekend(h.date) && isHolidayNoticeDue(today, h.date, workspace.noticeDays),
    );

    for (const holiday of upcoming) {
      const [claim] = await db
        .insert(schema.publicHolidayNotices)
        .values({ workspaceId: workspace.id, holidayId: holiday.id, observedDate: holiday.date })
        .onConflictDoNothing()
        .returning();
      if (!claim) continue;

      const ownerId = await workspaceOwnerId(workspace.id);
      if (!ownerId) continue;

      const activity = await logActivity(
        workspace.id,
        ownerId,
        "holiday",
        holiday.id,
        "holiday.upcoming",
        {
          name: holiday.name,
          date: holiday.date,
          observedDate: holiday.date,
          isObservedSubstitute: holiday.isObservedSubstitute,
        },
      );
      const memberIds = await listActiveMemberIds(workspace.id);
      await notifyUsers(activity.id, memberIds);

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
            subject: `Public holiday: ${holiday.name} — ${formatDay(holiday.date)}`,
            text: [
              `${holiday.name} is coming up. Day off: ${formatDay(holiday.date)}.`,
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

/** P8.2: is HR's "add next year's official holidays" reminder due for this workspace today? */
export async function holidaysMissingNextYear(workspaceId: string, now = new Date()) {
  const today = todayReportDate(now);
  const nextYear = Number(today.slice(0, 4)) + 1;
  const rows = await loadHolidayRows(workspaceId, nextYear);
  return { year: nextYear, missing: holidaysMissingFor(today, rows) };
}

/**
 * P8.2 (spec §12 holidays_missing): in December, HR hears once — in-app —
 * when next year's calendar is empty or still has an unconfirmed Eid. The
 * claim is public_holiday_years.missing_notified_at.
 */
export async function sendHolidaysMissingNotices(now = new Date()) {
  const today = todayReportDate(now);
  if (today.slice(5, 7) !== "12") return;
  const nextYear = Number(today.slice(0, 4)) + 1;
  const workspaces = await db.select({ id: schema.workspaces.id }).from(schema.workspaces);
  for (const workspace of workspaces) {
    const { missing } = await holidaysMissingNextYear(workspace.id, now);
    if (!missing) continue;

    await db
      .insert(schema.publicHolidayYears)
      .values({ workspaceId: workspace.id, year: nextYear })
      .onConflictDoNothing();
    const [claim] = await db
      .update(schema.publicHolidayYears)
      .set({ missingNotifiedAt: new Date() })
      .where(
        and(
          eq(schema.publicHolidayYears.workspaceId, workspace.id),
          eq(schema.publicHolidayYears.year, nextYear),
          isNull(schema.publicHolidayYears.missingNotifiedAt),
        ),
      )
      .returning({ id: schema.publicHolidayYears.id });
    if (!claim) continue;

    const ownerId = await workspaceOwnerId(workspace.id);
    if (!ownerId) continue;
    const activity = await logActivity(
      workspace.id,
      ownerId,
      "workspace",
      workspace.id,
      "holiday.missing",
      { year: nextYear },
    );
    await notifyUsers(activity.id, await listHrUserIds(workspace.id));
  }
}
