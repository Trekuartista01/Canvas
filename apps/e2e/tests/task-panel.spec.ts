import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("task panel: the Work section starts closed, opens on click, and closes again for the next task", async ({
  page,
}) => {
  await signUp(page, "Panel Tester");
  await createWorkspaceAndOpen(page, "Panel Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const column = page.getByTestId("status-column-Pending");
  await column.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("First task");
  await page.keyboard.press("Enter");
  await column.getByRole("button", { name: "First task" }).click();

  const panel = page.getByTestId("task-detail-panel");
  const work = panel.getByTestId("detail-group-Work");
  await expect(work).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByLabel("New checklist name")).toHaveCount(0);
  await expect(panel.getByLabel("Upload attachment")).toHaveCount(0);
  await expect(panel.getByTestId("generation-panel")).toHaveCount(0);
  // Everything outside it is still there.
  await expect(panel.getByLabel("Assign someone")).toBeVisible();
  await expect(panel.getByTestId("card-client")).toBeVisible();

  await work.click();
  await expect(work).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByLabel("New checklist name")).toBeVisible();
  await expect(panel.getByLabel("Upload attachment")).toBeAttached();

  await page.keyboard.press("Escape");
  await column.getByRole("button", { name: "First task" }).click();
  await expect(panel.getByTestId("detail-group-Work")).toHaveAttribute("aria-expanded", "false");
});
