import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("inviting someone lets you pick a custom role directly, and it's applied on acceptance", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Owner Tester");
  await createWorkspaceAndOpen(page, "Invite Roles Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");

  // Create a "Staff" custom role (revokes task:create) via the Roles page's
  // quick-start template.
  await page.getByRole("link", { name: "Roles" }).click();
  await page.getByTestId("role-template-staff").click();
  await page.getByTestId("custom-role-create").click();
  await expect(page.getByTestId("custom-role-list")).toContainText("Staff");

  // The custom role now shows up in the invite dropdown, grouped separately
  // from the base roles.
  await page.getByRole("link", { name: "All workspaces" }).click();
  const inviteRoleSelect = page.getByLabel("Invite role");
  await expect(inviteRoleSelect.locator('option[value^="custom:"]')).toHaveText("Staff");

  const bobEmail = `bob-invited-staff-${Date.now()}@example.com`;
  await page.getByPlaceholder("teammate@example.com").fill(bobEmail);
  await inviteRoleSelect.selectOption({ label: "Staff" });
  await page.getByRole("button", { name: "Invite" }).click();
  const link = page.locator("p", { hasText: "Invite link:" }).locator("span");
  await expect(link).toBeVisible();
  const inviteLink = await link.textContent();
  if (!inviteLink) throw new Error("Invite link was empty");

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Staff", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByRole("link", { name: "Open" })).toBeVisible();

  // Owner's Home page reflects Bob's custom role immediately, without
  // needing to assign it manually.
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByLabel("Custom role for Bob Staff")).toHaveValue(/.+/);

  // Bob himself is blocked from creating a task, same as manually assigning
  // the role would produce (custom-roles.spec.ts / role-templates.spec.ts
  // already cover the reverse assignment path).
  await bobPage.getByRole("link", { name: "Open" }).click();
  await bobPage.getByRole("link", { name: "Sprint" }).click();
  await bobPage.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = bobPage.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await bobPage.getByPlaceholder("Task title").fill("Should not save");
  await bobPage.keyboard.press("Enter");
  await expect(todoColumn.getByText("Should not save")).not.toBeVisible();

  await bobContext.close();
});
