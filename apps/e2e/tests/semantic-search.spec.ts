import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  signUp,
  fillGenerationContext,
} from "./helpers";

test("Phase 6: semantic task search ranks by meaning, and visual search finds a similar generated image", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await signUp(page, "Search Tester");
  await createWorkspaceAndOpen(page, "Search Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();

  const todoColumn = page.getByTestId("status-column-Pending");

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Draft onboarding paperwork for new hires");
  await page.keyboard.press("Enter");
  await expect(todoColumn.getByText("Draft onboarding paperwork for new hires")).toBeVisible();

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Fix database migration rollback bug");
  await page.keyboard.press("Enter");
  await expect(todoColumn.getByText("Fix database migration rollback bug")).toBeVisible();

  await page.getByRole("link", { name: "Smart Search", exact: true }).click();
  await page
    .getByTestId("semantic-search-input")
    .fill("paperwork for new hires onboarding documents");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  const results = page.getByTestId("semantic-search-results");
  await expect(results).toBeVisible();
  const resultRows = results.locator("li");
  await expect(resultRows).toHaveCount(2, { timeout: 10_000 });
  // The topically-related task ranks first — real cosine-similarity
  // ordering, not just "both matched".
  await expect(resultRows.first()).toContainText("Draft onboarding paperwork for new hires");

  // --- Visual search: generate two separate images, then find one from the other ---
  // exact:true avoids the semantic-search result rows still on screen,
  // whose accessible name also contains "Sprint" (the space/list label).
  await page.getByRole("link", { name: "Sprint", exact: true }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Launch art A");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Launch art A" }).click();
  const panelA = page.getByTestId("task-detail-panel");
  const genA = panelA.getByTestId("generation-panel");
  await genA.getByTestId("generation-prompt").fill("a bold red product shot");
  await fillGenerationContext(genA);
  await genA.getByTestId("generation-submit").click();
  await expect(genA.getByTestId("generation-variants")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Close task details" }).click();

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Launch art B");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Launch art B" }).click();
  const panelB = page.getByTestId("task-detail-panel");
  const genB = panelB.getByTestId("generation-panel");
  await genB.getByTestId("generation-prompt").fill("a bold red product photo");
  await fillGenerationContext(genB);
  await genB.getByTestId("generation-submit").click();
  await expect(genB.getByTestId("generation-variants")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Close task details" }).click();

  await page.getByRole("link", { name: "Smart Search", exact: true }).click();
  const picker = page.getByTestId("visual-search-picker");
  await expect(picker.locator("button")).toHaveCount(2, { timeout: 10_000 });
  await picker.locator("button").first().click();

  const similarResults = page.getByTestId("visual-search-results");
  await expect(similarResults.locator("button")).toHaveCount(1, { timeout: 15_000 });
});
