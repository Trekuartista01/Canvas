import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createWorkspaceAndOpen, signUp } from "./helpers";

const IMAGE_FIXTURE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));

test("profile: edit name/bio/title, upload an avatar, and see it render in the workspace", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Ada Owner");
  await createWorkspaceAndOpen(page, "Profile Test Workspace");

  await page.goto("/account");
  await page.getByTestId("profile-name-input").fill("Ada Renamed");
  await page.getByTestId("profile-bio-input").fill("Building things.");
  await page.getByTestId("profile-title-input").fill("Product Designer");
  const saved = page.waitForResponse((res) => res.url().includes("auth.updateProfile"));
  await page.getByTestId("profile-save").click();
  await saved;
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ada Renamed" })).toBeVisible();

  // The new name round-trips through useSession and shows up back in the
  // workspace shell's own footer badge, not just on the account page.
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByText("Ada Renamed")).toBeVisible();

  // Upload an avatar from the account page.
  await page.goto("/account");
  await page.getByTestId("profile-avatar-file").setInputFiles(IMAGE_FIXTURE);
  await expect(page.locator('img[src*="/avatars/"]')).toBeVisible({ timeout: 15_000 });

  // Back in the workspace, the shell's own user badge renders the avatar as
  // a real image instead of the initials fallback.
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.locator('img[src*="/avatars/"]').first()).toBeVisible({ timeout: 15_000 });
});
