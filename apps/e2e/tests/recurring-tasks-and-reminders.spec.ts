import { db, schema } from "@canvas/db";
import { expect, test } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

function localDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test("M3.5: a recurring task spawns its next occurrence, a due reminder notifies", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await signUp(page, "Recurring Tester");
  await createWorkspaceAndOpen(page, "Recurring Workspace");
  await createSpaceAndList(page, "Ops", "Standups");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Weekly standup");
  await page.keyboard.press("Enter");
  await expect(todoColumn.getByRole("button", { name: "Weekly standup" })).toBeVisible();

  await page.getByRole("button", { name: "Weekly standup" }).click();
  const panel = page.getByTestId("task-detail-panel");
  await panel.getByTestId("task-recurrence").selectOption("weekly");
  await expect(panel.getByTestId("task-recurrence")).toHaveValue("weekly");

  // Also set up a reminder that's already due, so the worker's very next
  // tick fires both checks at once.
  await panel
    .getByTestId("reminder-remind-at")
    .fill(localDateTimeInputValue(new Date(Date.now() - 60_000)));
  await panel.getByTestId("reminder-add").click();
  await expect(panel.getByText("No reminders set.")).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Setting "Weekly" schedules the next occurrence ~7 days out — jump it to
  // already-due directly in the DB (the same kind of setup M1.3's 5k-row
  // perf check did by hand via SQL, just automated here) rather than
  // waiting a real week. The scheduler tick interval itself is still real
  // and unmocked (SCHEDULER_TICK_MS=3000 for this webServer, see
  // playwright.config.ts), so the actual spawn logic runs for real.
  // Scoped to the list just created above (via its own most-recently-created
  // lookup), not a bare title match — repeated local runs against a
  // never-reset dev DB accumulate many "Weekly standup" tasks across
  // workspaces, and an unscoped findFirst (no orderBy) can nondeterministically
  // grab a stale one from an earlier run, silently updating the wrong
  // recurrence rule. Not an issue in CI's always-fresh DB, but a real bug
  // in the test either way. See PROGRESS.md.
  const list = await db.query.lists.findFirst({
    where: eq(schema.lists.name, "Standups"),
    orderBy: [desc(schema.lists.createdAt)],
  });
  if (!list) throw new Error("List not found");
  const task = await db.query.tasks.findFirst({
    where: and(eq(schema.tasks.listId, list.id), eq(schema.tasks.title, "Weekly standup")),
  });
  if (!task) throw new Error("Task not found");
  await db
    .update(schema.recurrenceRules)
    .set({ nextRunAt: new Date() })
    .where(eq(schema.recurrenceRules.taskId, task.id));

  // Poll for the spawned sibling task to appear (a second "Weekly standup"
  // card) — bounded well above the 3s tick interval for slow CI runners.
  await expect
    .poll(async () => todoColumn.getByRole("button", { name: "Weekly standup" }).count(), {
      timeout: 20_000,
    })
    .toBe(2);

  // The rule advanced to a new future occurrence rather than repeating
  // immediately on the following tick.
  const rule = await db.query.recurrenceRules.findFirst({
    where: eq(schema.recurrenceRules.taskId, task.id),
  });
  expect(rule?.nextRunAt.getTime()).toBeGreaterThan(Date.now());

  // The due reminder fired into a notification — NotificationsBell polls
  // every 30s (refetchInterval), it isn't WS-pushed, so this needs a
  // timeout comfortably past one full poll cycle, not just the scheduler
  // tick interval.
  const bell = page.getByRole("button", { name: "Notifications" });
  await expect(bell.getByText(/^\d+$/)).toBeVisible({ timeout: 35_000 });
  await bell.click();
  await expect(page.getByText("Reminder")).toBeVisible();
});
