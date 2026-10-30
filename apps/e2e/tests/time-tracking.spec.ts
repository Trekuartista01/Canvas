import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function todayDateOnly(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test("M3.7: track time with a live timer and a manual entry; timesheet total matches", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Timer Tester");
  await createWorkspaceAndOpen(page, "Timer Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Write release notes");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Write release notes" }).click();

  const panel = page.getByTestId("task-detail-panel");
  await expect(panel.getByLabel("Task title")).toHaveValue("Write release notes");

  // Live timer: start, let a couple of real seconds pass, stop.
  await panel.getByTestId("start-timer").click();
  await expect(panel.getByTestId("stop-timer")).toBeVisible();
  await expect(page.getByLabel("Stop timer")).toBeVisible(); // header widget too
  await page.waitForTimeout(2_500);

  const stopResponse = page.waitForResponse((res) => res.url().includes("timeEntry.stop"));
  await panel.getByTestId("stop-timer").click();
  await stopResponse;
  await expect(panel.getByTestId("start-timer")).toBeVisible();
  await expect(page.getByLabel("Stop timer")).toHaveCount(0);
  await expect(panel.getByText("running…")).toHaveCount(0);
  await expect(panel.getByTestId("time-tracked-total")).not.toHaveText("0s total");

  // Remove the timer entry so the manual entry below is the only one left —
  // keeps the total/timesheet checks below exact instead of "at least". The
  // delete button is hover-revealed, so hover the row first.
  const timerEntryRow = panel.locator('[data-testid^="time-entry-"]').first();
  await timerEntryRow.hover();
  await timerEntryRow.getByRole("button", { name: /Delete time entry/ }).click();
  await expect(panel.getByTestId("time-tracked-total")).toHaveText("0s total");

  // Manual entry: exactly 90 minutes today, so totals are checkable precisely.
  await panel.getByRole("button", { name: "+ Log time manually" }).click();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30, 0);
  await panel.getByLabel("Start time").fill(localDateTimeInputValue(start));
  await panel.getByLabel("End time").fill(localDateTimeInputValue(end));
  await panel.getByLabel("Time entry note").fill("Drafted the changelog");
  const manualCreated = page.waitForResponse((res) => res.url().includes("createManual"));
  await panel.getByRole("button", { name: "Log", exact: true }).click();
  await manualCreated;
  await expect(panel.getByText("Drafted the changelog")).toBeVisible();
  await expect(panel.getByTestId("time-tracked-total")).toHaveText("1h 30m total");

  // Timesheet defaults to the current week, which contains today.
  await page.goto(page.url().replace(/\/l\/.*$/, "/timesheet"));
  const today = todayDateOnly();
  await expect(page.getByTestId(`timesheet-day-${today}`)).toBeVisible();
  await expect(page.getByTestId(`timesheet-day-total-${today}`)).toHaveText("1h 30m");
  await expect(page.getByTestId("timesheet-total")).toHaveText("Total: 1h 30m");
  await expect(page.getByText("Write release notes")).toBeVisible();
});
