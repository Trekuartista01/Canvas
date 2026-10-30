import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, inviteAndGetLink, signUp } from "./helpers";

function dateOnlyOffsetFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("M3.8: workload shows tasks due this week per assignee, excludes tasks outside the range", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const name = "Workload Tester";
  await signUp(page, name);
  await createWorkspaceAndOpen(page, "Workload Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");

  for (const title of ["Design mockups", "Write copy"]) {
    await todoColumn.getByRole("button", { name: "+ Add task" }).click();
    await page.getByPlaceholder("Task title").fill(title);
    await page.keyboard.press("Enter");
    await expect(todoColumn.getByRole("button", { name: title })).toBeVisible();
  }

  const today = dateOnlyOffsetFromToday(0);
  const farFuture = dateOnlyOffsetFromToday(60);

  // "Design mockups": due today, assigned to self — should show up on the
  // current week's grid.
  await page.getByRole("button", { name: "Design mockups" }).click();
  let panel = page.getByTestId("task-detail-panel");
  await panel.getByTestId("task-due-date").fill(today);
  const assignedFirst = page.waitForResponse((res) => res.url().includes("assignees.add"));
  await panel.getByLabel("Assign someone").selectOption({ label: name });
  await assignedFirst;
  await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // "Write copy": due 60 days out, also assigned to self — outside this
  // week's range, so it must not appear on the default (current-week) grid.
  await page.getByRole("button", { name: "Write copy" }).click();
  panel = page.getByTestId("task-detail-panel");
  await panel.getByTestId("task-due-date").fill(farFuture);
  const assignedSecond = page.waitForResponse((res) => res.url().includes("assignees.add"));
  await panel.getByLabel("Assign someone").selectOption({ label: name });
  await assignedSecond;
  await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("link", { name: "Workload", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workload", exact: true })).toBeVisible();

  const userRow = page.locator('[data-testid^="workload-row-"]').filter({ hasText: name });
  await expect(userRow).toBeVisible();

  // Today's cell for this user shows "Design mockups"...
  const cellId = await userRow.getAttribute("data-testid");
  const userId = cellId!.replace("workload-row-", "");
  const todayCell = page.getByTestId(`workload-cell-${userId}-${today}`);
  await expect(todayCell.getByRole("button", { name: "Design mockups" })).toBeVisible();

  // ...but "Write copy" (60 days out) is nowhere on this week's grid, and
  // the weekly total only counts the one in-range task.
  await expect(page.getByText("Write copy")).toHaveCount(0);
  await expect(page.getByTestId(`workload-total-${userId}`)).toHaveText("1");

  // Clicking the chip opens the real task detail panel.
  await todayCell.getByRole("button", { name: "Design mockups" }).click();
  await expect(page.getByTestId("task-detail-panel").getByLabel("Task title")).toHaveValue(
    "Design mockups",
  );
});

test("Workload: shows each person's total open-task count and suggests diversifying when lopsided", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Nia Owner");
  await createWorkspaceAndOpen(page, "Diversify Workspace");

  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-workload-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, bobEmail);
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Member", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByRole("link", { name: "Open" })).toBeVisible();
  await bobContext.close();

  await page.getByRole("link", { name: "Open" }).click();
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");

  // Nia gets 4 open tasks, Bob gets 1 — a lopsided, roughly-4x split.
  for (const title of ["Task A", "Task B", "Task C", "Task D"]) {
    await todoColumn.getByRole("button", { name: "+ Add task" }).click();
    await page.getByPlaceholder("Task title").fill(title);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: title }).click();
    const assigned = page.waitForResponse((res) => res.url().includes("assignees.add"));
    await page
      .getByTestId("task-detail-panel")
      .getByLabel("Assign someone")
      .selectOption({ label: "Nia Owner" });
    await assigned;
    await page.getByRole("button", { name: "Close task details" }).click();
  }
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Task E");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Task E" }).click();
  const assignedBob = page.waitForResponse((res) => res.url().includes("assignees.add"));
  await page
    .getByTestId("task-detail-panel")
    .getByLabel("Assign someone")
    .selectOption({ label: "Bob Member" });
  await assignedBob;
  await page.getByRole("button", { name: "Close task details" }).click();

  await page.getByRole("link", { name: "Workload", exact: true }).click();
  const niaRow = page
    .locator('[data-testid^="workload-open-count-"]')
    .filter({ hasText: "Nia Owner" });
  const bobRow = page
    .locator('[data-testid^="workload-open-count-"]')
    .filter({ hasText: "Bob Member" });
  await expect(niaRow).toContainText("4");
  await expect(bobRow).toContainText("1");

  const suggestion = page.getByTestId("workload-diversify-suggestion");
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText("Nia Owner");
  await expect(suggestion).toContainText("4 open tasks");
  await expect(suggestion).toContainText("Bob Member");
  await expect(suggestion).toContainText("diversifying");
});
