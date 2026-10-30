import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  signUp,
  fillGenerationContext,
} from "./helpers";

test("Generation UX: set brand palette, generate variants, promote one, attach to task", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await signUp(page, "Gen UX Tester");
  await createWorkspaceAndOpen(page, "Gen UX Workspace");

  // Brand Kits page: first kit created becomes the workspace default automatically.
  await page.getByRole("link", { name: "Brand Kits", exact: true }).click();
  await expect(page.getByTestId("brand-kits-page")).toBeVisible();
  await page.getByTestId("brand-kit-new").click();
  await page.getByTestId("brand-kit-name").fill("Studio Default");
  const paletteInput = page.getByTestId("brand-kit-palette");
  await paletteInput.click();
  await paletteInput.pressSequentially("#FF0000, #00FF00");
  await page.getByTestId("brand-kit-save").click();
  await expect(page.getByText("Studio Default")).toBeVisible();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Studio Default")).toBeVisible();

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await createSpaceAndList(page, "Creative", "Campaigns");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Launch art");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Launch art" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Launch art");

  const panel = page.getByTestId("task-detail-panel");
  const gen = panel.getByTestId("generation-panel");
  await expect(gen).toBeVisible();

  await gen.getByTestId("generation-prompt").fill("a bold red product shot");
  await fillGenerationContext(gen);
  await gen.getByTestId("generation-n").selectOption("2");
  await gen.getByTestId("generation-use-brand").check();
  await gen.getByTestId("generation-submit").click();

  await expect(gen.getByTestId("generation-variants")).toBeVisible({ timeout: 30_000 });
  const variants = gen
    .getByTestId("generation-variants")
    .locator("button[data-testid^='image-version-']");
  await expect(variants).toHaveCount(2, { timeout: 30_000 });

  // With n=2 the worker promotes the last variant; switch current to the first.
  await variants.nth(0).click();
  await expect(variants.nth(0)).toHaveAttribute("aria-pressed", "true");
  await gen.getByTestId("generation-promote").click();
  await expect(gen.getByTestId("generation-promote")).toHaveText("Current version");

  await gen.getByTestId("generation-attach").click();
  await expect(gen.getByText("Attached to task")).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText(/Attachments \(1\)/)).toBeVisible({ timeout: 10_000 });
});

test("Brand Kits: a space's assigned kit wins over the workspace default", async ({ page }) => {
  test.setTimeout(60_000);

  await signUp(page, "Brand Kit Tester");
  await createWorkspaceAndOpen(page, "Brand Kit Workspace");

  // Workspace default kit has no palette set.
  await page.getByRole("link", { name: "Brand Kits", exact: true }).click();
  await page.getByTestId("brand-kit-new").click();
  await page.getByTestId("brand-kit-name").fill("Workspace Default");
  await page.getByTestId("brand-kit-save").click();
  await expect(page.getByText("Workspace Default")).toBeVisible();

  // A second kit, with a palette, will be assigned to one space only.
  await page.getByTestId("brand-kit-new").click();
  await page.getByTestId("brand-kit-name").fill("Client B");
  const paletteInput = page.getByTestId("brand-kit-palette");
  await paletteInput.click();
  await paletteInput.pressSequentially("#112233, #445566");
  await page.getByTestId("brand-kit-save").click();
  await expect(page.getByText("Client B")).toBeVisible();

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await createSpaceAndList(page, "Client B Space", "Deliverables");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await createSpaceAndList(page, "Internal Space", "Ops");

  // Assign Client B's kit to Client B Space (Internal Space keeps the default).
  await page.getByRole("link", { name: "Brand Kits", exact: true }).click();
  await page
    .getByTestId("space-kit-list")
    .locator("li", { hasText: "Client B Space" })
    .getByLabel("Brand kit for Client B Space")
    .selectOption({ label: "Client B" });

  // Inside Client B Space, generation resolves the space-assigned kit (has a palette).
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Deliverables" }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page
    .getByTestId("status-column-Pending")
    .getByRole("button", { name: "+ Add task" })
    .click();
  await page.getByPlaceholder("Task title").fill("Client B task");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Client B task" }).click();
  const clientPanel = page.getByTestId("task-detail-panel").getByTestId("generation-panel");
  await expect(clientPanel.getByText("(none set yet)")).not.toBeVisible();
  await page.getByTestId("task-detail-panel").getByLabel("Close", { exact: true }).click();

  // Inside Internal Space (no assignment), generation falls back to the empty default kit.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Ops" }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page
    .getByTestId("status-column-Pending")
    .getByRole("button", { name: "+ Add task" })
    .click();
  await page.getByPlaceholder("Task title").fill("Internal task");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Internal task" }).click();
  const internalPanel = page.getByTestId("task-detail-panel").getByTestId("generation-panel");
  await expect(internalPanel.getByText("(none set yet)")).toBeVisible();
});
