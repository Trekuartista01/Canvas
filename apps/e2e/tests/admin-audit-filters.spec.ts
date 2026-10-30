import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("Admin audit log: filter by entity type, action text, and date range", async ({ page }) => {
  await signUp(page, "Audit Tester");
  await createWorkspaceAndOpen(page, "Audit Workspace");
  await createSpaceAndList(page, "Ops", "Tracked");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Audited task");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-card-Audited task")).toBeVisible();

  await page.getByRole("link", { name: "Admin", exact: true }).click();
  const audit = page.getByTestId("admin-audit");
  await expect(audit).toBeVisible();
  const list = page.getByTestId("admin-audit-list");
  const listCreatedRow = list.getByText("list.created · list", { exact: true });
  const taskCreatedRow = list.getByText("task.created · task", { exact: true });
  await expect(listCreatedRow).toBeVisible();
  await expect(taskCreatedRow).toBeVisible();

  // Narrow to just task activity.
  await page.getByTestId("admin-audit-entity-filter").selectOption("task");
  await expect(taskCreatedRow).toBeVisible();
  await expect(listCreatedRow).toHaveCount(0);

  // Free-text action search, independent of the entity-type filter.
  await page.getByTestId("admin-audit-entity-filter").selectOption("");
  await page.getByTestId("admin-audit-verb-filter").fill("list");
  await expect(listCreatedRow).toBeVisible();
  await expect(taskCreatedRow).toHaveCount(0);
  await page.getByTestId("admin-audit-verb-filter").fill("");

  // A date range entirely in the future excludes everything that just happened.
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const futureStr = future.toISOString().slice(0, 10);
  await page.getByTestId("admin-audit-from-filter").fill(futureStr);
  await expect(audit.getByText("No activity matches these filters.")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(taskCreatedRow).toBeVisible();
  await expect(listCreatedRow).toBeVisible();
});
