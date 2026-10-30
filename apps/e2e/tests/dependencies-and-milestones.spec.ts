import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

async function addDependency(page: import("@playwright/test").Page, dependsOnLabel: string) {
  const panel = page.getByTestId("task-detail-panel");
  await panel.getByLabel("Depends on").selectOption({ label: dependsOnLabel });
  await panel.getByLabel("Dependency kind").selectOption("blocks");
  await panel.getByRole("button", { name: "Add dependency" }).click();
}

test("M3.4: manage dependencies from the task panel, reject a cycle, mark a milestone", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Dependency Tester");
  await createWorkspaceAndOpen(page, "Dependency Workspace");
  await createSpaceAndList(page, "Ops", "Rollout");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  for (const title of ["Design", "Build", "Launch"]) {
    await todoColumn.getByRole("button", { name: "+ Add task" }).click();
    await page.getByPlaceholder("Task title").fill(title);
    await page.keyboard.press("Enter");
    await expect(todoColumn.getByRole("button", { name: title })).toBeVisible();
  }

  // Chain: Build depends on Design, Launch depends on Build.
  await page.getByRole("button", { name: "Build" }).click();
  await addDependency(page, "Design");
  await expect(page.getByTestId("task-detail-panel").getByText("Blocked by")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Launch" }).click();
  await addDependency(page, "Build");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Reload and confirm both edges persisted, then check both directions
  // show up together on Build's own panel (blocked by Design, blocking Launch).
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Build" }).click();
  const buildPanel = page.getByTestId("task-detail-panel");
  await expect(buildPanel.getByText("Blocked by")).toBeVisible();
  await expect(buildPanel.getByRole("button", { name: "Design", exact: true })).toBeVisible();
  await expect(buildPanel.getByText("Blocking")).toBeVisible();
  await expect(buildPanel.getByRole("button", { name: "Launch", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Design depending on Launch would close the loop:
  // Design -> Launch -> Build -> Design. No direct edge exists between
  // Design and Launch yet, so the option is offered — and the server's
  // cycle check (not just the UI's same-pair filter) must reject it.
  await page.getByRole("button", { name: "Design" }).click();
  await addDependency(page, "Launch");
  await expect(page.getByTestId("task-detail-panel").getByText(/dependency cycle/i)).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Mark Launch as a milestone with a due date and confirm it renders as a
  // diamond marker on the Gantt, not a bar.
  await page.getByRole("button", { name: "Launch" }).click();
  const launchPanel = page.getByTestId("task-detail-panel");
  const now = new Date();
  const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-20`;
  await launchPanel.getByTestId("task-due-date").fill(due);
  await launchPanel.getByTestId("task-is-milestone").click();
  await expect(launchPanel.getByTestId("task-is-milestone")).toBeChecked();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Gantt", exact: true }).click();
  const gantt = page.getByTestId("task-gantt-view");
  await expect(gantt).toBeVisible();
  await expect(gantt.locator('[data-testid^="gantt-milestone-"]')).toHaveCount(1);
  await expect(gantt.locator('[data-testid^="gantt-bar-"]', { hasText: "Launch" })).toHaveCount(0);
});
