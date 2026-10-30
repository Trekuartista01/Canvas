import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("M4.2 docs: link task, Brain generates inline image", async ({ page }) => {
  test.setTimeout(120_000);

  await signUp(page, "Docs Brain Tester");
  await createWorkspaceAndOpen(page, "Docs Brain Workspace");
  await createSpaceAndList(page, "Creative", "Campaigns");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Hero banner");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hero banner" })).toBeVisible();

  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await expect(page.getByTestId("docs-list-page")).toBeVisible();
  await page.getByTestId("docs-new").click();
  await page.getByTestId("docs-new-title").fill("Campaign brief");
  await page.getByTestId("docs-create").click();
  await expect(page.getByTestId("doc-editor-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("doc-sync-status")).toHaveText("Synced", { timeout: 15_000 });

  await page.getByTestId("doc-task-link-search").fill("Hero banner");
  await expect(page.getByText("Hero banner").first()).toBeVisible({ timeout: 10_000 });
  await page.locator("[data-testid^='doc-task-link-result-']").first().click();
  await expect(page.locator("[data-testid^='doc-task-link-']").first()).toBeVisible();

  await page.getByTestId("doc-ask-brain").click();
  const brainPanel = page.getByTestId("brain-chat-panel");
  await expect(brainPanel).toBeVisible();
  await expect(brainPanel.getByText("Brain — this doc")).toBeVisible();

  await brainPanel
    .getByTestId("brain-message-input")
    .fill("Generate an image of a red square banner");
  await brainPanel.getByRole("button", { name: "Send" }).click();

  await expect(brainPanel.getByText(/generate_image completed successfully/i)).toBeVisible({
    timeout: 45_000,
  });

  await brainPanel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("doc-inline-image")).toBeVisible({ timeout: 15_000 });
});
