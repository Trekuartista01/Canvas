import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  signUp,
  fillGenerationContext,
} from "./helpers";

test("M2.6 version tree: branch siblings, compare, promote", async ({ page }) => {
  test.setTimeout(120_000);

  await signUp(page, "Tree Tester");
  await createWorkspaceAndOpen(page, "Tree Workspace");
  await createSpaceAndList(page, "Creative", "Campaigns");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Tree art");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Tree art" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Tree art");

  const gen = page.getByTestId("task-detail-panel").getByTestId("generation-panel");
  await expect(gen).toBeVisible();

  await gen.getByTestId("generation-prompt").fill("a green bottle");
  await fillGenerationContext(gen);
  await gen.getByTestId("generation-n").selectOption("1");
  await gen.getByTestId("generation-submit").click();

  await expect(gen.getByTestId("generation-version-tree")).toBeVisible({ timeout: 30_000 });
  const variants = gen
    .getByTestId("generation-variants")
    .locator("button[data-testid^='image-version-']");
  await expect(variants).toHaveCount(1, { timeout: 30_000 });
  await expect(gen.getByTestId("generation-job-status")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });

  const rootId = (await variants.first().getAttribute("data-testid"))!.replace(
    "image-version-",
    "",
  );

  // Two branches from the same root
  await gen.getByTestId("generation-edit-instruction").fill("make it matte");
  await gen.getByTestId("generation-edit-submit").click();
  await expect(variants).toHaveCount(2, { timeout: 30_000 });
  await expect(gen.getByTestId("generation-job-status")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });

  // Select root again and branch a sibling
  await gen.getByTestId(`image-version-${rootId}`).click();
  await expect(gen.getByTestId(`image-version-${rootId}`)).toHaveAttribute("aria-pressed", "true");
  await gen.getByTestId("generation-edit-instruction").fill("make it glossy");
  await gen.getByTestId("generation-edit-submit").click();
  await expect(variants).toHaveCount(3, { timeout: 30_000 });
  await expect(gen.getByTestId("generation-job-status")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });

  const childRows = gen.locator(`[data-testid^="version-tree-row-"][data-parent="${rootId}"]`);
  await expect(childRows).toHaveCount(2, { timeout: 10_000 });
  await expect(childRows.first()).toHaveAttribute("data-depth", "1");
  await expect(childRows.nth(1)).toHaveAttribute("data-depth", "1");

  // Compare root vs first child
  const firstChildId = (await childRows.first().getAttribute("data-testid"))!.replace(
    "version-tree-row-",
    "",
  );
  await gen.getByTestId(`image-version-${rootId}`).click();
  await gen.getByTestId(`version-compare-toggle-${firstChildId}`).click();
  await expect(gen.getByTestId("version-compare")).toBeVisible();
  await expect(gen.getByTestId("version-compare-left")).toBeVisible();
  await expect(gen.getByTestId("version-compare-right")).toBeVisible();

  // Promote first child as current
  await gen.getByTestId(`image-version-${firstChildId}`).click();
  await gen.getByTestId("generation-promote").click();
  await expect(gen.getByTestId("generation-promote")).toHaveText("Current version");
});
