import { db, schema } from "@canvas/db";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { env } from "../env";
import { getEmailClient } from "../email";
import { logActivity } from "./activity";
import { sendDailyReportReminders } from "./daily-report-reminders";
import { sendHolidayNotices } from "./holiday-notices";
import { applyLeaveCarryOver } from "./leave-carry-over";
import { sendContractExpiryNotices } from "./contract-expiry";
import { seedMissingHolidayCalendars } from "./working-days";
import { buildDigestEmail } from "./digest";
import { nextOrderKey } from "./order";
import { computeNextRunAt } from "./recurrence";
import { publish } from "./realtime";
import {
  firstStatusForList,
  lastTaskOrderKey,
  workspaceIdForList,
  workspaceIdForTask,
} from "./task-queries";

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Spawns a fresh task from each due recurring template and advances (or
 * retires) its rule. Runs on every scheduler tick (apps/api/src/queues/
 * scheduler-queue.ts) — see PROGRESS.md (M3.5) for why the worker owns
 * this instead of it living in the task.recurrence.set/clear mutations.
 */
async function spawnDueRecurringTasks() {
  const now = new Date();
  const dueRules = await db.query.recurrenceRules.findMany({
    where: lte(schema.recurrenceRules.nextRunAt, now),
  });

  for (const rule of dueRules) {
    const template = await db.query.tasks.findFirst({
      where: and(eq(schema.tasks.id, rule.taskId), isNull(schema.tasks.deletedAt)),
    });
    if (!template) {
      // Template task was deleted (or soft-deleted) since the rule last
      // ran — nothing sensible to spawn; retire the orphaned rule.
      await db.delete(schema.recurrenceRules).where(eq(schema.recurrenceRules.id, rule.id));
      continue;
    }

    const status = await firstStatusForList(template.listId);
    const lastKey = await lastTaskOrderKey(template.listId, status.id);

    const [spawned] = await db
      .insert(schema.tasks)
      .values({
        listId: template.listId,
        title: template.title,
        statusId: status.id,
        priority: template.priority,
        dueDate: dateOnly(rule.nextRunAt),
        orderKey: nextOrderKey(lastKey),
        createdBy: template.createdBy,
      })
      .returning();
    if (!spawned) continue;

    const workspaceId = await workspaceIdForList(template.listId);
    await logActivity(
      workspaceId,
      template.createdBy,
      "task",
      spawned.id,
      "task.recurrence_spawned",
      { fromTaskId: template.id },
    );
    await publish(workspaceId, {
      entity: "task",
      id: spawned.id,
      listId: template.listId,
      kind: "created",
    });

    const next = computeNextRunAt(rule.rrule, rule.nextRunAt);
    if (next) {
      await db
        .update(schema.recurrenceRules)
        .set({ nextRunAt: next, updatedAt: now })
        .where(eq(schema.recurrenceRules.id, rule.id));
    } else {
      // Rule text has COUNT/UNTIL and is now exhausted (not reachable via
      // this milestone's presets, but the column allows arbitrary RRULE
      // text — see computeNextRunAt).
      await db.delete(schema.recurrenceRules).where(eq(schema.recurrenceRules.id, rule.id));
    }
  }
}

/**
 * Turns each due, task-linked reminder into an in-app notification via the
 * same activity -> notifications pipeline every other notification in this
 * app uses (M1.7's @mention notifications), then marks it done so it fires
 * exactly once. Standalone (taskless) reminders have no workspace to log
 * an activity row against — see PROGRESS.md for why they're out of scope
 * this milestone.
 */
async function fireDueReminders() {
  const now = new Date();
  const dueReminders = await db.query.reminders.findMany({
    where: and(lte(schema.reminders.remindAt, now), isNull(schema.reminders.doneAt)),
  });

  for (const reminder of dueReminders) {
    const task = reminder.taskId
      ? await db.query.tasks.findFirst({
          where: and(eq(schema.tasks.id, reminder.taskId), isNull(schema.tasks.deletedAt)),
        })
      : null;
    if (!task) {
      // No task (standalone reminder, out of scope this milestone — see
      // module comment) or its task was deleted since the reminder was
      // set: nothing to notify about, but still mark it done so it
      // doesn't get re-checked on every future tick.
      await db
        .update(schema.reminders)
        .set({ doneAt: now })
        .where(eq(schema.reminders.id, reminder.id));
      continue;
    }

    const workspaceId = await workspaceIdForTask(task.id);
    const activityRow = await logActivity(
      workspaceId,
      reminder.userId,
      "reminder",
      reminder.id,
      "reminder.fired",
      { taskId: task.id, listId: task.listId, note: reminder.note },
    );
    await db
      .insert(schema.notifications)
      .values({ userId: reminder.userId, activityId: activityRow.id });
    await db
      .update(schema.reminders)
      .set({ doneAt: now })
      .where(eq(schema.reminders.id, reminder.id));
  }
}

/**
 * M3.9: batches each user's unread notifications created since their last
 * digest into one email, then advances the cursor — whether or not there
 * was anything to send, so a quiet user doesn't get rechecked in full every
 * tick forever. `users.lastDigestSentAt` is the cursor (see PROGRESS.md;
 * not in DATA_MODEL.md's compact `users` row).
 */
async function sendDueDigests() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - env.DIGEST_INTERVAL_MS);
  const dueUsers = await db.query.users.findMany({
    where: or(isNull(schema.users.lastDigestSentAt), lte(schema.users.lastDigestSentAt, cutoff)),
  });

  const emailClient = getEmailClient();

  for (const user of dueUsers) {
    const since = user.lastDigestSentAt ?? user.createdAt;

    const unread = await db
      .select({ verb: schema.activity.verb, actorName: schema.users.name })
      .from(schema.notifications)
      .innerJoin(schema.activity, eq(schema.activity.id, schema.notifications.activityId))
      .innerJoin(schema.users, eq(schema.users.id, schema.activity.actorId))
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          isNull(schema.notifications.readAt),
          gt(schema.notifications.createdAt, since),
        ),
      );

    // Advance the cursor regardless — a user with nothing unread this
    // period shouldn't be re-queried in full on every future tick either.
    await db
      .update(schema.users)
      .set({ lastDigestSentAt: now })
      .where(eq(schema.users.id, user.id));

    if (unread.length === 0) continue;

    const { subject, text } = buildDigestEmail(unread, env.WEB_URL);
    await emailClient.send({ to: user.email, subject, text });
  }
}

export async function runSchedulerTick() {
  await spawnDueRecurringTasks();
  await fireDueReminders();
  await sendDueDigests();
  // M7.4: backfill the holiday calendar for workspaces created before it existed.
  await seedMissingHolidayCalendars(new Date().getUTCFullYear());
  await sendHolidayNotices();
  await sendDailyReportReminders();
  // M7.5: unused vacation carries into the new year (once per person per year).
  await applyLeaveCarryOver();
  // M7.6: HR hears 30 and 7 days before a contract expires.
  await sendContractExpiryNotices();
}
