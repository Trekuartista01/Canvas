import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("M3.3 gantt: dated tasks render bars, dependency draws an arrow", async ({ page }) => {
  test.setTimeout(60_000);

  await signUp(page, "Gantt Tester");
  await createWorkspaceAndOpen(page, "Gantt Workspace");
  await createSpaceAndList(page, "Ops", "Timeline");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  for (const title of ["Design", "Build"]) {
    await todoColumn.getByRole("button", { name: "+ Add task" }).click();
    await page.getByPlaceholder("Task title").fill(title);
    await page.keyboard.press("Enter");
    await expect(todoColumn.getByRole("button", { name: title })).toBeVisible();
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");

  await page.getByRole("button", { name: "Design" }).click();
  await page.getByLabel("Start date").fill(`${y}-${m}-05`);
  await page.getByTestId("task-due-date").fill(`${y}-${m}-08`);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Build" }).click();
  await page.getByLabel("Start date").fill(`${y}-${m}-09`);
  await page.getByTestId("task-due-date").fill(`${y}-${m}-14`);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Gantt", exact: true }).click();
  const gantt = page.getByTestId("task-gantt-view");
  await expect(gantt).toBeVisible();
  await expect(
    gantt.locator('[data-testid^="gantt-row-label-"]', { hasText: "Design" }),
  ).toBeVisible();

  // Both bars render, positioned in the timeline grid.
  const designBar = gantt.locator('[data-testid^="gantt-bar-"]', { hasText: "Design" });
  const buildBar = gantt.locator('[data-testid^="gantt-bar-"]', { hasText: "Build" });
  await expect(designBar).toBeVisible();
  await expect(buildBar).toBeVisible();

  // Wire "Build depends on Design" (blocks) and confirm an arrow + list row appear.
  await page.getByTestId("gantt-dep-task").selectOption({ label: "Build" });
  await page.getByTestId("gantt-dep-on-task").selectOption({ label: "Design" });
  await page.getByTestId("gantt-dep-kind").selectOption("blocks");
  await page.getByTestId("gantt-dep-add").click();

  await expect(gantt.getByTestId("gantt-dependency-list")).toBeVisible();
  await expect(gantt.getByText("Build depends on Design (blocks)")).toBeVisible();
  await expect(gantt.locator('[data-testid^="gantt-arrow-"]')).toHaveCount(1);

  // Reload and confirm the dependency persisted server-side, not just optimistic UI.
  await page.reload();
  await page.getByRole("button", { name: "Gantt", exact: true }).click();
  await expect(page.getByTestId("gantt-dependency-list")).toBeVisible();
  await expect(page.getByText("Build depends on Design (blocks)")).toBeVisible();

  // Remove it and confirm the arrow/list entry clear.
  const removeButton = page.locator('[data-testid^="gantt-dep-remove-"]');
  await removeButton.click();
  await expect(page.getByTestId("gantt-dependency-list")).toHaveCount(0);
});
