import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  signUp,
  fillGenerationContext,
} from "./helpers";

test("M2.5 iterative edit: generate → edit ×3 → attach", async ({ page }) => {
  test.setTimeout(120_000);

  await signUp(page, "Edit Loop Tester");
  await createWorkspaceAndOpen(page, "Edit Loop Workspace");
  await createSpaceAndList(page, "Creative", "Campaigns");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Hero loop");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Hero loop" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Hero loop");

  const panel = page.getByTestId("task-detail-panel");
  const gen = panel.getByTestId("generation-panel");
  await expect(gen).toBeVisible();

  await gen.getByTestId("generation-prompt").fill("a blue product shot");
  await fillGenerationContext(gen);
  await gen.getByTestId("generation-n").selectOption("1");
  await gen.getByTestId("generation-submit").click();

  await expect(gen.getByTestId("generation-job-status")).toBeVisible({ timeout: 10_000 });
  await expect(gen.getByTestId("generation-variants")).toBeVisible({ timeout: 30_000 });
  let variants = gen
    .getByTestId("generation-variants")
    .locator("button[data-testid^='image-version-']");
  await expect(variants).toHaveCount(1, { timeout: 30_000 });
  await expect(gen.getByTestId("generation-job-status")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });

  const edits = ["make it warmer", "add soft shadows", "crop tighter on the product"];
  for (let i = 0; i < edits.length; i++) {
    await gen.getByTestId("generation-edit-instruction").fill(edits[i]!);
    await gen.getByTestId("generation-edit-submit").click();
    await expect(gen.getByTestId("generation-job-status")).toBeVisible();
    variants = gen
      .getByTestId("generation-variants")
      .locator("button[data-testid^='image-version-']");
    await expect(variants).toHaveCount(i + 2, { timeout: 30_000 });
    await expect(gen.getByTestId("generation-job-status")).toHaveAttribute("data-status", "done", {
      timeout: 30_000,
    });
  }

  await gen.getByTestId("generation-attach").click();
  await expect(gen.getByText("Attached to task")).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText(/Attachments \(1\)/)).toBeVisible({ timeout: 10_000 });
});
