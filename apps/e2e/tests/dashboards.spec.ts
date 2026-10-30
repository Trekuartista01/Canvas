import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test("M5.2 dashboards: task counts, burndown, and time-tracked widgets reflect real workspace data", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Dashboard Owner");
  await createWorkspaceAndOpen(page, "Dashboard Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Design homepage");
  await page.keyboard.press("Enter");

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Ship banner");
  await page.keyboard.press("Enter");

  // Move "Ship banner" to Done, and log 90 minutes of time on "Design homepage".
  await page.getByRole("button", { name: "Ship banner" }).click();
  const panel = page.getByTestId("task-detail-panel");
  const doneUpdate = page.waitForResponse((res) => res.url().includes("task.update"));
  await panel.getByLabel("Status").selectOption({ label: "Completed" });
  await doneUpdate;
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Design homepage" }).click();
  await panel.getByRole("button", { name: "+ Log time manually" }).click();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30, 0);
  await panel.getByLabel("Start time").fill(localDateTimeInputValue(start));
  await panel.getByLabel("End time").fill(localDateTimeInputValue(end));
  const manualCreated = page.waitForResponse((res) => res.url().includes("createManual"));
  await panel.getByRole("button", { name: "Log", exact: true }).click();
  await manualCreated;
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Build the dashboard.
  await page.getByRole("link", { name: "Dashboards", exact: true }).click();
  await expect(page.getByTestId("dashboards-list-page")).toBeVisible();
  await page.getByTestId("dashboards-new").click();
  await page.getByTestId("dashboards-new-name").fill("Sprint overview");
  const dashboardCreated = page.waitForResponse((res) => res.url().includes("dashboard.create"));
  await page.getByTestId("dashboards-create").click();
  await dashboardCreated;
  await expect(page.getByTestId("dashboard-editor-page")).toBeVisible();

  // Task counts widget: one Open, one Done.
  const widgetGrid = page.getByTestId("widget-grid");
  const taskCountsAdded = page.waitForResponse((res) => res.url().includes("widget.add"));
  await page.getByTestId("add-widget").click();
  await taskCountsAdded;
  // Widgets are appended in order, so the first direct child of the grid is
  // this one — scoped to `> div` so it doesn't also match the nested
  // "widget-table" testid one level down.
  const taskCountsWidget = widgetGrid.locator("> div").first();
  await expect(taskCountsWidget.getByText("Task counts")).toBeVisible();
  const taskCountsTable = taskCountsWidget.getByTestId("widget-table");
  const openStat = taskCountsTable.locator("div", { hasText: "Open" });
  await expect(openStat.getByText("1", { exact: true })).toBeVisible();
  const doneStat = taskCountsTable.locator("div", { hasText: "Done" });
  await expect(doneStat.getByText("1", { exact: true })).toBeVisible();

  // Burndown widget: one task still remains (Design homepage).
  await page.getByTestId("widget-type-select").selectOption("burndown");
  const burndownAdded = page.waitForResponse((res) => res.url().includes("widget.add"));
  await page.getByTestId("add-widget").click();
  await burndownAdded;
  await expect(page.getByText("Remaining now: 1")).toBeVisible();

  // Time tracked widget: 90 minutes = 1.5h logged today.
  await page.getByTestId("widget-type-select").selectOption("time_tracked");
  const timeTrackedAdded = page.waitForResponse((res) => res.url().includes("widget.add"));
  await page.getByTestId("add-widget").click();
  await timeTrackedAdded;
  await expect(page.getByText("Total: 1.5h")).toBeVisible();

  // Removing a widget takes it off the dashboard. Scoped to the grid, not
  // the whole page — the toolbar's type <select> always has a "Task
  // counts" <option>, which would otherwise never hit zero.
  await taskCountsWidget.getByRole("button", { name: "Remove widget" }).click();
  await expect(widgetGrid.getByText("Task counts")).toHaveCount(0);

  // Reload: the dashboard and its remaining widgets persist server-side.
  await page.reload();
  await expect(page.getByText("Remaining now: 1")).toBeVisible();
  await expect(page.getByText("Total: 1.5h")).toBeVisible();
  await expect(page.getByTestId("widget-grid").getByText("Task counts")).toHaveCount(0);
});

test("Dashboards: assignee and priority breakdown widgets reflect real workspace data", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Breakdown Owner");
  await createWorkspaceAndOpen(page, "Breakdown Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Assigned urgent task");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Assigned urgent task" }).click();
  const assigned = page.waitForResponse((res) => res.url().includes("assignees.add"));
  await page.getByLabel("Assign someone").selectOption({ label: "Breakdown Owner" });
  await assigned;
  const urgentSet = page.waitForResponse((res) => res.url().includes("task.update"));
  await page.getByLabel("Priority").selectOption({ label: "Urgent" });
  await urgentSet;
  await page.getByRole("button", { name: "Close task details" }).click();

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Unassigned task");
  await page.keyboard.press("Enter");

  await page.getByRole("link", { name: "Dashboards", exact: true }).click();
  await page.getByTestId("dashboards-new").click();
  await page.getByTestId("dashboards-new-name").fill("Team breakdowns");
  const dashboardCreated = page.waitForResponse((res) => res.url().includes("dashboard.create"));
  await page.getByTestId("dashboards-create").click();
  await dashboardCreated;

  const widgetGrid = page.getByTestId("widget-grid");

  await page.getByTestId("widget-type-select").selectOption("assignee_breakdown");
  const assigneeAdded = page.waitForResponse((res) => res.url().includes("widget.add"));
  await page.getByTestId("add-widget").click();
  await assigneeAdded;
  const assigneeWidget = widgetGrid.locator("> div").filter({ hasText: "Open tasks by assignee" });
  const assigneeTable = assigneeWidget.getByTestId("widget-table");
  await expect(assigneeTable.locator("div", { hasText: "Breakdown Owner" })).toBeVisible();
  await expect(assigneeTable.locator("div", { hasText: "Unassigned" })).toBeVisible();

  await page.getByTestId("widget-type-select").selectOption("priority_breakdown");
  const priorityAdded = page.waitForResponse((res) => res.url().includes("widget.add"));
  await page.getByTestId("add-widget").click();
  await priorityAdded;
  const priorityWidget = widgetGrid.locator("> div").filter({ hasText: "Open tasks by priority" });
  const priorityTable = priorityWidget.getByTestId("widget-table");
  await expect(priorityTable.locator("div", { hasText: "Urgent" })).toBeVisible();
  await expect(priorityTable.locator("div", { hasText: "None" })).toBeVisible();
});
