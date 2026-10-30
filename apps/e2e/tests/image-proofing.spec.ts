import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  signUp,
  fillGenerationContext,
} from "./helpers";

test("M4.4 image proofing: pin a comment on a version, switch versions, pin survives, and Brain critiques", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await signUp(page, "Proofing Tester");
  await createWorkspaceAndOpen(page, "Proofing Workspace");
  await createSpaceAndList(page, "Creative", "Campaigns");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Poster draft");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Poster draft" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Poster draft");

  const panel = page.getByTestId("task-detail-panel");
  const gen = panel.getByTestId("generation-panel");
  await expect(gen).toBeVisible();

  await gen.getByTestId("generation-prompt").fill("a poster mockup");
  await fillGenerationContext(gen);
  await gen.getByTestId("generation-n").selectOption("1");
  await gen.getByTestId("generation-submit").click();

  const variants = gen
    .getByTestId("generation-variants")
    .locator("button[data-testid^='image-version-']");
  await expect(variants).toHaveCount(1, { timeout: 30_000 });
  const firstVersionTestId = await variants.first().getAttribute("data-testid");
  const firstVersionId = firstVersionTestId!.replace("image-version-", "");

  const proofing = gen.getByTestId("image-proofing");
  await expect(proofing).toBeVisible();

  // Pin a comment on the first version
  await proofing.getByTestId("proofing-image").click({ position: { x: 20, y: 20 } });
  await proofing.getByTestId("proofing-pin-composer").fill("Fix the headline contrast here");
  await proofing.getByTestId("proofing-pin-submit").click();

  await expect(proofing.locator("[data-testid^='proofing-pin-']")).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(proofing.getByText("Fix the headline contrast here")).toBeVisible();

  // Branch a second version — pins are per-version, so the new version
  // should start with none while the first version's pin stays intact.
  await gen.getByTestId("generation-edit-instruction").fill("make the poster darker");
  await gen.getByTestId("generation-edit-submit").click();
  await expect(variants).toHaveCount(2, { timeout: 30_000 });

  const variantTestIds = await variants.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-testid")),
  );
  const secondVersionTestId = variantTestIds.find((id) => id !== firstVersionTestId);
  await page.locator(`[data-testid="${secondVersionTestId}"]`).click();
  await expect(proofing.locator("[data-testid^='proofing-pin-']")).toHaveCount(0, {
    timeout: 10_000,
  });

  // Switch back to the first version — the pin must still be there
  // (per-version anchoring, ROADMAP's Phase 4 accept criterion).
  await page.locator(`[data-testid="image-version-${firstVersionId}"]`).click();
  await expect(proofing.locator("[data-testid^='proofing-pin-']")).toHaveCount(1, {
    timeout: 10_000,
  });
  await expect(proofing.getByText("Fix the headline contrast here")).toBeVisible();

  // Delete the pin
  await proofing.getByRole("button", { name: "Delete pin comment" }).click();
  await expect(proofing.locator("[data-testid^='proofing-pin-']")).toHaveCount(0, {
    timeout: 10_000,
  });

  // AI critique
  await proofing.getByTestId("proofing-ask-brain").click();
  const brainPanel = page.getByTestId("brain-chat-panel");
  await expect(brainPanel).toBeVisible();
  await expect(brainPanel.getByText("Brain — this task")).toBeVisible();

  await brainPanel
    .getByTestId("brain-message-input")
    .fill(`What would you improve about image ${firstVersionId}?`);
  await brainPanel.getByRole("button", { name: "Send" }).click();

  await expect(brainPanel.getByText(/critique_image completed successfully/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(brainPanel.getByText(/Suggested improvements/i)).toBeVisible({ timeout: 15_000 });
});
