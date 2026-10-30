import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("M3.2 table: inline edit + bulk set priority", async ({ page }) => {
  test.setTimeout(60_000);

  await signUp(page, "Table Tester");
  await createWorkspaceAndOpen(page, "Table Workspace");
  await createSpaceAndList(page, "Ops", "Spreadsheet");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todo = page.getByTestId("status-column-Pending");
  for (const title of ["Alpha row", "Beta row"]) {
    await todo.getByRole("button", { name: "+ Add task" }).click();
    await page.getByPlaceholder("Task title").fill(title);
    await page.keyboard.press("Enter");
    await expect(todo.getByRole("button", { name: title })).toBeVisible();
  }

  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.getByTestId("task-table-view");
  await expect(table).toBeVisible();
  await expect(table.getByText("Alpha row")).toBeVisible({ timeout: 10_000 });
  await expect(table.getByText("Beta row")).toBeVisible();

  const priorities = table.locator('[data-testid^="table-priority-"]');
  await expect(priorities).toHaveCount(2);
  await priorities.first().selectOption("high");
  await expect(priorities.first()).toHaveValue("high");

  await table.getByTestId("table-select-all").check();
  await expect(table.getByTestId("table-bulk-bar")).toBeVisible();
  await table.getByTestId("table-bulk-priority").selectOption("urgent");
  await table.getByTestId("table-bulk-apply").click();
  await expect(table.getByTestId("table-bulk-bar")).toHaveCount(0, { timeout: 10_000 });

  await expect(priorities.nth(0)).toHaveValue("urgent");
  await expect(priorities.nth(1)).toHaveValue("urgent");
});
