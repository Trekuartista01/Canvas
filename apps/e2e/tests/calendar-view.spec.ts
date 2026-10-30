import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("M3.1 calendar: set due date, see task on day, open from calendar", async ({ page }) => {
  test.setTimeout(60_000);

  await signUp(page, "Calendar Tester");
  await createWorkspaceAndOpen(page, "Calendar Workspace");
  await createSpaceAndList(page, "Ops", "Schedule");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Ship calendar");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Ship calendar" }).click();

  // Pick a date in the current month so the calendar opens on the right grid.
  const now = new Date();
  const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
  await page.getByTestId("task-due-date").fill(due);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const calendar = page.getByTestId("task-calendar-view");
  await expect(calendar).toBeVisible();
  await expect(calendar.getByTestId(`calendar-day-${due}`)).toBeVisible();

  const chip = calendar.getByTestId(`calendar-day-${due}`).getByRole("button", {
    name: "Ship calendar",
  });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByTestId("task-detail-panel")).toBeVisible();
  await expect(page.getByTestId("task-due-date")).toHaveValue(due);
});
