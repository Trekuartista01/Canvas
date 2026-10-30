import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  signUp,
  fillGenerationContext,
} from "./helpers";

test("M2.7: pick image engine, generate, see auto alt-text/tags", async ({ page }) => {
  test.setTimeout(90_000);

  await signUp(page, "Engine Tester");
  await createWorkspaceAndOpen(page, "Engine Workspace");

  await page.getByRole("link", { name: "Brand Kits", exact: true }).click();
  await page.getByTestId("brand-kit-new").click();
  await page.getByTestId("brand-kit-name").fill("Studio Default");
  await page.getByTestId("brand-kit-image-engine").selectOption({ label: "Generation quality" });
  await page.getByTestId("brand-kit-save").click();
  await expect(page.getByText("Studio Default")).toBeVisible();

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await createSpaceAndList(page, "Creative", "Campaigns");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Tagged art");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Tagged art" }).click();

  const gen = page.getByTestId("task-detail-panel").getByTestId("generation-panel");
  await gen.getByTestId("generation-prompt").fill("a vivid coral seashell");
  await fillGenerationContext(gen);
  await gen.getByTestId("generation-n").selectOption("1");
  await gen.getByTestId("generation-submit").click();

  await expect(gen.getByTestId("generation-job-status")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });
  await expect(gen.getByTestId("generation-alt-text")).toContainText(/coral seashell/i, {
    timeout: 10_000,
  });
  await expect(gen.getByTestId("generation-tags")).toContainText(/coral|seashell/i);
});
