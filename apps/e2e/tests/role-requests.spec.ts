import { db, schema } from "@canvas/db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  createWorkspaceAndOpen,
  inviteAndGetLink,
  pageAs,
  seedMember,
  signUp,
  uniqueEmail,
  workspaceIdFrom,
} from "./helpers";

async function signUpThroughInvite(
  browser: Browser,
  inviteLink: string,
  name: string,
  roleLabel?: string,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(inviteLink);
  await page.getByRole("link", { name: /Sign up with/ }).click();
  await page.locator("#name").fill(name);
  await page.locator("#password").fill("e2e-test-password");
  if (roleLabel) {
    await page.getByLabel("Your role").selectOption({ label: roleLabel });
    await expect(page.getByTestId("role-request-note")).toBeVisible();
  }
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open" })).toBeVisible();
  return page;
}

async function membershipOf(workspaceId: string, email: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const [row] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, user!.id)),
    );
  return row!;
}

function payrollStatus(page: Page, workspaceId: string) {
  return page.request
    .get(`/trpc/payroll.list?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`)
    .then((res) => res.status());
}

test("role requests: picking a role at sign-up grants nothing until an Admin approves it", async ({
  page: admin,
  browser,
}) => {
  test.setTimeout(120_000);

  // Without an invite there's no workspace to ask, so no question.
  await admin.goto("/signup");
  await expect(admin.getByLabel("Your role")).toHaveCount(0);

  await signUp(admin, "Admin Owner");
  await createWorkspaceAndOpen(admin, "Requests Workspace");
  const ws = workspaceIdFrom(admin);
  const workspaceUrl = admin.url();

  const hannaEmail = uniqueEmail("hanna");
  const carlEmail = uniqueEmail("carl");
  const eveEmail = uniqueEmail("eve");
  const danEmail = uniqueEmail("dan");
  await admin.getByRole("link", { name: "All workspaces" }).click();
  const hannaInvite = await inviteAndGetLink(admin, hannaEmail);
  const carlInvite = await inviteAndGetLink(admin, carlEmail);
  const eveInvite = await inviteAndGetLink(admin, eveEmail);
  const danInvite = await inviteAndGetLink(admin, danEmail);

  // Hanna asks for HR. The important part: she has no HR access yet.
  const hanna = await signUpThroughInvite(browser, hannaInvite, "Hanna Hope", "HR/Finance Manager");
  const pending = await membershipOf(ws, hannaEmail);
  expect(pending.peopleRole).toBe("employee");
  expect(pending.requestedPeopleRole).toBe("hr_finance");
  expect(await payrollStatus(hanna, ws)).toBe(403);

  // Carl asks to be Ops. Eve picks nothing, so there's nothing to approve.
  const carl = await signUpThroughInvite(browser, carlInvite, "Carl Claim", "Operations Manager");
  const eve = await signUpThroughInvite(browser, eveInvite, "Eve Employee");
  expect((await membershipOf(ws, eveEmail)).requestedPeopleRole).toBeNull();

  // Only the Admin can see or decide requests.
  const hannaUser = await db.query.users.findFirst({ where: eq(schema.users.email, hannaEmail) });
  const staffQueue = await eve.request.get(
    `/trpc/people.roleRequests?input=${encodeURIComponent(JSON.stringify({ workspaceId: ws }))}`,
  );
  expect(staffQueue.status()).toBe(403);
  const hr = await seedMember(ws, "Hana Seeded", "hr_finance");
  const hrPage = await pageAs(browser, hr, ws);
  for (const page of [eve, hanna, hrPage]) {
    const decided = await page.request.post("/trpc/people.decideRoleRequest", {
      data: { workspaceId: ws, userId: hannaUser!.id, approve: true },
    });
    expect(decided.status()).toBe(403);
  }
  expect((await membershipOf(ws, hannaEmail)).peopleRole).toBe("employee");

  // The Admin hears about it and sees the queue in Directory.
  await admin.goto(workspaceUrl);
  await admin.getByRole("button", { name: "Notifications" }).click();
  await expect(admin.getByText("Hanna Hope asked to be HR/Finance Manager")).toBeVisible();
  await admin.keyboard.press("Escape");
  await admin.getByRole("link", { name: "Directory" }).click();
  const queue = admin.getByTestId("role-requests");
  await expect(queue).toContainText("Role requests (2)");
  await expect(queue).toContainText("Asked to be Operations Manager");
  await expect(queue).not.toContainText("Eve Employee");

  // Approve: the role applies, access opens, and it goes through the usual trail.
  await admin
    .getByTestId("role-request-Hanna Hope")
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(admin.getByTestId("role-request-Hanna Hope")).toHaveCount(0);
  const approved = await membershipOf(ws, hannaEmail);
  expect(approved.peopleRole).toBe("hr_finance");
  expect(approved.requestedPeopleRole).toBeNull();
  expect(await payrollStatus(hanna, ws)).toBe(200);
  const audited = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.workspaceId, ws),
        eq(schema.auditLog.action, "person.role_changed"),
        eq(schema.auditLog.entityId, hannaUser!.id),
      ),
    );
  expect(audited).toHaveLength(1);
  await hanna.goto(workspaceUrl);
  await hanna.getByRole("button", { name: "Notifications" }).click();
  await expect(hanna.getByText("approved your role request").first()).toBeVisible();

  // Decline: no role, and no second chance at the same click.
  await admin
    .getByTestId("role-request-Carl Claim")
    .getByRole("button", { name: "Decline" })
    .click();
  await expect(queue).toHaveCount(0);
  const declined = await membershipOf(ws, carlEmail);
  expect(declined.peopleRole).toBe("employee");
  expect(declined.requestedPeopleRole).toBeNull();
  const carlUser = await db.query.users.findFirst({ where: eq(schema.users.email, carlEmail) });
  const again = await admin.request.post("/trpc/people.decideRoleRequest", {
    data: { workspaceId: ws, userId: carlUser!.id, approve: true },
  });
  expect(again.status()).toBe(409);
  expect((await membershipOf(ws, carlEmail)).peopleRole).toBe("employee");
  await carl.goto(workspaceUrl);
  await carl.getByRole("button", { name: "Notifications" }).click();
  await expect(carl.getByText("turned down your role request").first()).toBeVisible();

  // Someone with an account already asks when accepting: same request, no access.
  const danContext = await browser.newContext();
  const dan = await danContext.newPage();
  await signUp(dan, "Dan Existing", danEmail);
  await dan.goto(danInvite);
  await dan.getByLabel("Your role").selectOption({ label: "CEO" });
  await dan.getByRole("button", { name: /Accept & join/ }).click();
  await expect(dan.getByRole("link", { name: "Open" }).first()).toBeVisible();
  const danRow = await membershipOf(ws, danEmail);
  expect(danRow.peopleRole).toBe("employee");
  expect(danRow.requestedPeopleRole).toBe("ceo");

  // Setting the role by hand settles a waiting request too.
  const danUser = await db.query.users.findFirst({ where: eq(schema.users.email, danEmail) });
  const direct = await admin.request.post("/trpc/people.setRole", {
    data: { workspaceId: ws, userId: danUser!.id, peopleRole: "operations_manager" },
  });
  expect(direct.ok()).toBe(true);
  expect((await membershipOf(ws, danEmail)).requestedPeopleRole).toBeNull();

  // "Admin" itself can't be requested, and a request without an invite does nothing.
  const forgedEmail = uniqueEmail("forged");
  const forged = await hanna.request.post("/trpc/auth.signUp", {
    data: {
      name: "Forged",
      email: forgedEmail,
      password: "e2e-test-password",
      requestedRole: "admin",
    },
  });
  expect(forged.status()).toBe(400);
});
