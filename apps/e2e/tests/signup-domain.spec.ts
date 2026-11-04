import { db, schema } from "@canvas/db";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  createWorkspaceAndOpen,
  seedMember,
  signUp,
  uniqueEmail,
  workspaceIdFrom,
} from "./helpers";

const companyEmail = (name: string) =>
  `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trekuartista.com`;

async function linkFor(request: import("@playwright/test").APIRequestContext, email: string) {
  const res = await request.get(`/test-hooks/signup-link?email=${encodeURIComponent(email)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { path: string }).path;
}

const userWith = (email: string) =>
  db.query.users.findFirst({ where: eq(schema.users.email, email) });

test("sign-up: only company addresses, and only after opening the emailed link", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  // Another domain is refused on the spot, and nothing is created.
  await page.goto("/signup");
  await page.locator("#name").fill("Outsider");
  await page.locator("#email").fill("outsider@gmail.com");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("alert")).toContainText("Canvas is only for");
  expect(await userWith("outsider@gmail.com")).toBeUndefined();

  // Look-alikes too, straight at the API.
  for (const email of ["a@trekuartista.com.evil.com", "a@evil-trekuartista.com"]) {
    const res = await page.request.post("/trpc/auth.signUp", { data: { name: "X", email } });
    expect(res.status(), email).toBe(403);
  }

  // A company address gets an email. No account exists, and it can't log in yet.
  const email = companyEmail("olsi");
  await page.locator("#name").fill("Olsi Sopi");
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByTestId("signup-sent")).toContainText(email);
  expect(await userWith(email)).toBeUndefined();

  // A second request replaces the link: the first stops working.
  const firstLink = await linkFor(page.request, email);
  const repeat = await page.request.post("/trpc/auth.signUp", {
    data: { name: "Olsi Sopi", email },
  });
  expect(repeat.ok()).toBe(true);
  const link = await linkFor(page.request, email);
  expect(link).not.toBe(firstLink);
  await page.goto(firstLink);
  await expect(page.getByTestId("signup-link-invalid")).toContainText(
    "expired or was already used",
  );

  // The link is what makes the account, with the password chosen there.
  await page.goto(link);
  await expect(page.getByText(email)).toBeVisible();
  await page.locator("#password").fill("a-good-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("link", { name: /workspace/i }).first()).toBeVisible();
  expect((await userWith(email))?.name).toBe("Olsi Sopi");

  // A link works once.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto(link);
  await expect(other.getByTestId("signup-link-invalid")).toBeVisible();

  // Trying the address again changes nothing and reveals nothing: same answer,
  // no new link, and the existing password stands.
  const again = await other.request.post("/trpc/auth.signUp", { data: { name: "Mallory", email } });
  expect(again.ok()).toBe(true);
  expect(await linkFor(other.request, email)).toBe(link);
  expect((await userWith(email))?.name).toBe("Olsi Sopi");

  // Logging in works for them.
  await other.goto("/login");
  await other.locator("#email").fill(email);
  await other.locator("#password").fill("a-good-password");
  await other.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(other).not.toHaveURL(/login/);
});

test("the domain rule covers logging in, invites and Add staff", async ({
  page: owner,
  browser,
}) => {
  await signUp(owner, "Admin Owner");
  await createWorkspaceAndOpen(owner, "Domain Workspace");
  const ws = workspaceIdFrom(owner);

  // An old account outside the domain can't log in.
  const outsider = `old-${Date.now()}@gmail.com`;
  await db.insert(schema.users).values({ email: outsider, name: "Old", passwordHash: "x" });
  const login = await owner.request.post("/trpc/auth.logIn", {
    data: { email: outsider, password: "whatever-it-is" },
  });
  expect(login.status()).toBe(403);
  expect(await login.text()).toContain("Canvas is only for");

  // Nobody can be invited or added from outside it.
  const invite = await owner.request.post("/trpc/workspace.invite", {
    data: { workspaceId: ws, email: "friend@gmail.com", role: "member" },
  });
  expect(invite.status()).toBe(403);

  const hr = await seedMember(ws, "Hana HR", "hr_finance");
  const context = await browser.newContext();
  await context.addCookies([
    { name: "canvas_session", value: hr.sessionId, url: "http://localhost:5183" },
  ]);
  const added = await context.request.post("/trpc/people.createStaff", {
    data: {
      workspaceId: ws,
      name: "Friend",
      email: "friend@gmail.com",
      password: "a-good-password",
    },
  });
  expect(added.status()).toBe(403);
  const allowed = await context.request.post("/trpc/people.createStaff", {
    data: {
      workspaceId: ws,
      name: "Colleague",
      email: uniqueEmail("colleague"),
      password: "a-good-password",
    },
  });
  expect(allowed.ok()).toBe(true);
});
