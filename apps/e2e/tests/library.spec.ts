import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  inviteAndGetLink,
  signUp,
  fillGenerationContext,
} from "./helpers";

const IMAGE_FIXTURE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));

test("Library: a generated image is saved in Canvas, searchable/filterable, and deletable", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Library Tester");
  await createWorkspaceAndOpen(page, "Library Workspace");
  await createSpaceAndList(page, "Creative", "Campaigns");
  await page.getByRole("button", { name: "Board", exact: true }).click();

  await page.getByTestId("status-column-To Do").getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Launch art");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Launch art" }).click();

  const panel = page.getByTestId("task-detail-panel");
  const gen = panel.getByTestId("generation-panel");
  await gen.getByTestId("generation-prompt").fill("a vivid teal mountain landscape");
  await fillGenerationContext(gen);
  await gen.getByTestId("generation-submit").click();
  await expect(gen.getByTestId("generation-variants")).toBeVisible({ timeout: 30_000 });

  // The Generate panel links straight to the Library once something's saved.
  await gen.getByRole("link", { name: "view in Library" }).click();
  await expect(page.getByTestId("library-page")).toBeVisible();

  const grid = page.getByTestId("library-grid");
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);

  // Search matches the AI-written alt text ("Image of a vivid teal mountain landscape").
  await page.getByTestId("library-search").fill("teal mountain");
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);
  await page.getByTestId("library-search").fill("nonexistent-query-xyz");
  await expect(page.getByTestId("library-empty")).toContainText("No images match");
  await page.getByTestId("library-search").fill("");

  // Origin filter: this asset came from Generate, not an upload.
  await page.getByTestId("library-origin-upload").click();
  await expect(page.getByTestId("library-empty")).toContainText("No images match");
  await page.getByTestId("library-origin-generation").click();
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);

  // Open the detail panel and delete it.
  await grid.locator("[data-testid^='library-item-']").first().click();
  const detail = page.getByTestId("library-detail-panel");
  await expect(detail).toBeVisible();
  await expect(detail.locator("p", { hasText: "Prompt:" })).toContainText(
    "a vivid teal mountain landscape",
  );
  await detail.getByTestId("library-delete").click();
  await expect(detail).not.toBeVisible();
  await expect(page.getByTestId("library-empty")).toBeVisible();
});

test("Library: uploading an image directly, nav lives under Collaborate, and guests can view it", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Library Owner");
  await createWorkspaceAndOpen(page, "Library Upload Workspace");

  // Moved out of "Work" into "Collaborate", alongside Docs/Forms/Brand Kits.
  const collaborateGroup = page.locator("nav > div").filter({ hasText: "Collaborate" });
  const libraryLink = collaborateGroup.getByRole("link", { name: "Library", exact: true });
  await expect(libraryLink).toBeVisible();
  await libraryLink.click();
  await expect(page.getByTestId("library-page")).toBeVisible();

  const uploaded = page.waitForResponse(
    (res) => res.url().includes("/image-assets/upload") && res.request().method() === "POST",
  );
  await page.getByTestId("library-upload-input").setInputFiles(IMAGE_FIXTURE);
  await uploaded;

  const grid = page.getByTestId("library-grid");
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);
  // Alt text defaults to the filename (sans extension) — no AI vision call
  // is spent on an upload the way it is for a generation/edit.
  await expect(grid.getByText("test-image")).toBeVisible();

  await page.getByTestId("library-origin-generation").click();
  await expect(page.getByTestId("library-empty")).toBeVisible();
  await page.getByTestId("library-origin-upload").click();
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);

  // Invite a guest — imageAsset:view is guest-tier, so they should see the
  // uploaded image in the Library without needing member/admin access.
  await page.getByRole("link", { name: "All workspaces" }).click();
  const guestEmail = `library-guest-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, guestEmail, "guest");

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await signUp(guestPage, "Library Guest", guestEmail);
  await guestPage.goto(inviteLink);
  await guestPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(guestPage.getByRole("link", { name: "Open" })).toBeVisible();
  await guestPage.getByRole("link", { name: "Open" }).click();

  await guestPage
    .locator("nav > div")
    .filter({ hasText: "Collaborate" })
    .getByRole("link", { name: "Library", exact: true })
    .click();
  await expect(
    guestPage.getByTestId("library-grid").locator("[data-testid^='library-item-']"),
  ).toHaveCount(1);
  await guestContext.close();
});

test("Library: folders organize saved images, and the detail panel can download one", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Folder Tester");
  await createWorkspaceAndOpen(page, "Folder Workspace");
  await page.getByRole("link", { name: "Library", exact: true }).click();

  const uploaded = page.waitForResponse(
    (res) => res.url().includes("/image-assets/upload") && res.request().method() === "POST",
  );
  await page.getByTestId("library-upload-input").setInputFiles(IMAGE_FIXTURE);
  await uploaded;
  const grid = page.getByTestId("library-grid");
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);

  // Create a folder — creating one switches the view straight to it, empty
  // until something's filed there.
  await page.getByTestId("library-folder-new").click();
  await page.getByTestId("library-folder-new-name").fill("Zone Club");
  await page.getByTestId("library-folder-new-submit").click();
  await expect(page.getByTestId("library-empty")).toBeVisible();

  // Back to "All folders", move the uploaded image into it.
  await page.getByTestId("library-folder-all").click();
  await grid.locator("[data-testid^='library-item-']").first().click();
  const detail = page.getByTestId("library-detail-panel");
  await expect(detail).toBeVisible();
  await detail.getByTestId("library-move-folder").selectOption({ label: "Zone Club" });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Zone Club", exact: true }).click();
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);
  await page.getByTestId("library-folder-all").click();
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);

  // Download from the detail panel.
  await grid.locator("[data-testid^='library-item-']").first().click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("library-download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("test-image");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Deleting the folder unfiles the image rather than deleting it.
  await page.getByRole("button", { name: "Delete folder Zone Club" }).click();
  await expect(page.getByText("Zone Club")).toHaveCount(0);
  await expect(grid.locator("[data-testid^='library-item-']")).toHaveCount(1);
});

test("Generate panel: images can be saved directly into a chosen folder", async ({ page }) => {
  test.setTimeout(60_000);

  await signUp(page, "Generate Folder Tester");
  await createWorkspaceAndOpen(page, "Generate Folder Workspace");

  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByTestId("library-folder-new").click();
  await page.getByTestId("library-folder-new-name").fill("Zone Club");
  await page.getByTestId("library-folder-new-submit").click();
  await expect(page.getByTestId("library-empty")).toBeVisible();

  await createSpaceAndList(page, "Creative", "Campaigns");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByTestId("status-column-To Do").getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Launch art");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Launch art" }).click();

  const gen = page.getByTestId("task-detail-panel").getByTestId("generation-panel");
  await gen.getByTestId("generation-prompt").fill("a bold red product shot");
  await fillGenerationContext(gen);
  await gen.getByTestId("generation-folder").selectOption({ label: "Zone Club" });
  await gen.getByTestId("generation-submit").click();
  await expect(gen.getByTestId("generation-variants")).toBeVisible({ timeout: 30_000 });

  await gen.getByRole("link", { name: "view in Library" }).click();
  await page.getByRole("button", { name: "Zone Club", exact: true }).click();
  await expect(
    page.getByTestId("library-grid").locator("[data-testid^='library-item-']"),
  ).toHaveCount(1);
});
