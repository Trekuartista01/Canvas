import { expect, test } from "@playwright/test";
import { createWorkspaceAndOpen, signUp } from "./helpers";

test("Account deletion: a user who owns no workspace can delete their account", async ({
  page,
}) => {
  const email = await signUp(page, "Deletable User");

  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  await page.getByTestId("delete-account-start").click();
  await page.getByTestId("delete-account-confirm-email").fill(email);
  await page.getByTestId("delete-account-confirm").click();

  // Redirected to login, and the account no longer exists — signing back in
  // with the same credentials now fails.
  await expect(page).toHaveURL(/\/login$/);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("e2e-test-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});

test("Account deletion: blocked while the user owns a workspace with the reason shown", async ({
  page,
}) => {
  const email = await signUp(page, "Owner User");
  await createWorkspaceAndOpen(page, "Owned Workspace");

  await page.getByRole("link", { name: "All workspaces" }).click();
  await page.getByRole("link", { name: "Account settings" }).click();

  await page.getByTestId("delete-account-start").click();
  await page.getByTestId("delete-account-confirm-email").fill(email);
  await page.getByTestId("delete-account-confirm").click();

  const dangerZone = page.getByTestId("danger-zone-section");
  await expect(dangerZone.getByText(/Owned Workspace/)).toBeVisible();
  await expect(dangerZone.getByText(/make someone else the owner/)).toBeVisible();
  // Still logged in — the deletion never happened.
  await expect(page).toHaveURL(/\/account$/);
});
