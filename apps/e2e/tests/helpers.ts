import { db, schema } from "@canvas/db";
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

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
/** Creates a board with an extra list and opens that list's own page. */
export async function createSpaceAndList(page: Page, spaceName: string, listName: string) {
  await page.getByRole("link", { name: "Boards", exact: true }).click();
  await page.getByTestId("new-board").click();
  await page.getByPlaceholder("Board name").fill(spaceName);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: spaceName })).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("add-list").click();
  await page.getByPlaceholder("List name").fill(listName);
  await page.keyboard.press("Enter");
  await openList(page, spaceName, listName);
}

/** From anywhere in a workspace: a board's list, on its own page. */
export async function openList(page: Page, spaceName: string, listName: string) {
  await page.getByRole("link", { name: "Boards", exact: true }).click();
  await page.getByRole("tab", { name: spaceName }).click();
  await page.getByTestId(`board-list-${listName}`).getByRole("link", { name: listName }).click();
  await expect(page.getByRole("heading", { name: `# ${listName}` })).toBeVisible();
}

/** Puts a person on every board in the workspace, as an Ops Manager would. */
export async function addToAllBoards(workspaceId: string, userId: string) {
  const spaces = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(eq(schema.spaces.workspaceId, workspaceId));
  if (spaces.length === 0) return;
  await db
    .insert(schema.spaceMembers)
    .values(spaces.map((s) => ({ spaceId: s.id, userId })))
    .onConflictDoNothing();
}

/** The same, for someone known by email (an invited member). */
export async function addEmailToAllBoards(workspaceId: string, email: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  await addToAllBoards(workspaceId, user!.id);
}

/**
 * From inside a workspace: sets a member's people role from their People
 * profile (M7.1 — e.g. "operations_manager", who hears about finished tasks),
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

export type SeededMember = { userId: string; email: string; name: string; sessionId: string };

/**
 * P8.1: adds a member with this people role straight to the DB, with a
 * session, so a spec can act as HR (or ops/ceo/employee) without the
 * sign-up → invite → assign-role dance. The workspace owner is always admin
 * and never HR, so every HR flow needs a second person anyway.
 */
export async function seedMember(
  workspaceId: string,
  name: string,
  peopleRole: (typeof schema.peopleRole.enumValues)[number],
): Promise<SeededMember> {
  const email = uniqueEmail(peopleRole.replace(/_/g, "-"));
  const [user] = await db.insert(schema.users).values({ email, name }).returning();
  await db
    .insert(schema.memberships)
    .values({ workspaceId, userId: user!.id, role: "member", peopleRole });
  const [session] = await db
    .insert(schema.sessions)
    .values({ userId: user!.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .returning();
  return { userId: user!.id, email, name, sessionId: session!.id };
}

/** A fresh browser context signed in as `member`, opened on the workspace. */
export async function pageAs(browser: Browser, member: SeededMember, workspaceId: string) {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "canvas_session", value: member.sessionId, url: "http://localhost:5183" },
  ]);
  const page = await context.newPage();
  await page.goto(`/w/${workspaceId}`);
  return page;
}

/** Shorthand: seed an HR/Finance Manager and open the workspace as them. */
export async function openAsHr(browser: Browser, workspaceId: string, name = "Hana HR") {
  const hr = await seedMember(workspaceId, name, "hr_finance");
  return { hr, hrPage: await pageAs(browser, hr, workspaceId) };
}

/** The workspace id from a /w/<id>/… URL. */
export function workspaceIdFrom(page: Page) {
  return page.url().match(/\/w\/([^/]+)/)![1]!;
}
