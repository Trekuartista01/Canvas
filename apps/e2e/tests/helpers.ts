import { expect, type Locator, type Page } from "@playwright/test";

export function uniqueEmail(prefix = "e2e") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function signUp(page: Page, name = "E2E Tester", email = uniqueEmail()) {
  await page.goto("/signup");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("e2e-test-password");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText(email)).toBeVisible();
  return email;
}

/** Logs in an existing account (e.g. one HR created) and lands on the workspace list. */
export async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(email)).toBeVisible();
}

export async function createWorkspaceAndOpen(page: Page, name: string) {
  await page.getByRole("link", { name: "New workspace" }).click();
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

/** Invites an email to the workspace shown on the dashboard and returns the invite link. */
export async function inviteAndGetLink(page: Page, email: string, role?: "admin" | "guest") {
  await page.getByPlaceholder("teammate@example.com").fill(email);
  if (role) await page.getByLabel("Invite role").selectOption(role);
  await page.getByRole("button", { name: "Invite" }).click();
  const link = page.locator("p", { hasText: "Invite link:" }).locator("span");
  await expect(link).toBeVisible();
  const href = await link.textContent();
  if (!href) throw new Error("Invite link was empty");
  return href;
}

/** Fills the Generate panel clarifying questions required before submit. */
export async function fillGenerationContext(
  panel: Locator,
  opts: { use?: string; mustHave?: string; avoid?: string } = {},
) {
  await panel.getByTestId("generation-use-case").fill(opts.use ?? "social post");
  await panel
    .getByTestId("generation-must-have")
    .fill(opts.mustHave ?? "clear subject, high contrast");
  if (opts.avoid) await panel.getByTestId("generation-avoid").fill(opts.avoid);
}

/** Creates a space, then a list directly under it, and navigates into the list. */
export async function createSpaceAndList(page: Page, spaceName: string, listName: string) {
  await page.getByRole("button", { name: "New space" }).click();
  await page.getByPlaceholder("Space name").fill(spaceName);
  await page.keyboard.press("Enter");
  const spaceRow = page.locator("div.group", { hasText: spaceName }).first();
  await expect(spaceRow).toBeVisible();

  await spaceRow.hover();
  await spaceRow.getByRole("button", { name: "New list" }).click();
  await page.getByPlaceholder("List name").fill(listName);
  await page.keyboard.press("Enter");

  const listLink = page.getByRole("link", { name: listName });
  await expect(listLink).toBeVisible();
  await listLink.click();
  await expect(page.getByRole("heading", { name: `# ${listName}` })).toBeVisible();
}

/**
 * From inside a workspace: sets a member's people role from their People
 * profile (M7.1 — e.g. "operation_manager", who hears about finished tasks),
 * then returns to Home.
 */
export async function setPeopleRole(page: Page, memberEmail: string, peopleRole: string) {
  await page.getByRole("link", { name: "Directory" }).click();
  await page.getByTestId(`person-row-${memberEmail}`).click();
  const roleSet = page.waitForResponse((res) => res.url().includes("people.setRole"));
  await page.locator("#person-role").selectOption(peopleRole);
  await roleSet;
  await expect(page.locator("#person-role")).toHaveValue(peopleRole);
  await page.getByRole("link", { name: "Home", exact: true }).click();
}
