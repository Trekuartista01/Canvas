import { db, schema } from "@canvas/db";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { signUp, uniqueEmail } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

test("logins stay saved: across a browser restart, renewed by use, until logging out", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("stays");
  await signUp(page, "Stays LoggedIn", email);
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.userId, user!.id),
  });

  // Saved for about a year, not just until the browser closes.
  const cookieExpiry = async () => {
    const cookies = await page.context().cookies();
    return cookies.find((c) => c.name === "canvas_session")!.expires * 1000;
  };
  expect(await cookieExpiry()).toBeGreaterThan(Date.now() + 360 * DAY);

  // A new browser with only what was saved to disk is still logged in.
  const saved = await page.context().storageState();
  const restarted = await browser.newContext({ storageState: saved });
  const reopened = await restarted.newPage();
  await reopened.goto("/");
  await expect(reopened.getByText(email)).toBeVisible();
  await expect(reopened).not.toHaveURL(/login/);
  // It shares this session, so its background requests could use up the renewal below.
  await reopened.goto("about:blank");

  // Someone using Canvas near the end of their time gets it extended, both on
  // the server and in the browser. Before this, the browser's copy ran out.
  await db
    .update(schema.sessions)
    .set({ expiresAt: new Date(Date.now() + 2 * DAY) })
    .where(eq(schema.sessions.id, session!.id));
  await page.context().addCookies([
    {
      name: "canvas_session",
      value: session!.id,
      url: "http://localhost:5183",
      expires: Math.floor((Date.now() + 2 * DAY) / 1000),
    },
  ]);
  await page.reload();
  await expect(page.getByText(email)).toBeVisible();
  await expect.poll(cookieExpiry).toBeGreaterThan(Date.now() + 360 * DAY);
  const renewed = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, session!.id),
  });
  expect(renewed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);

  // Logging out ends it, including for a saved copy of the cookie.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/login/);
  await reopened.goto("/");
  await expect(reopened).toHaveURL(/login/);
  expect(await db.query.sessions.findFirst({ where: eq(schema.sessions.id, session!.id) })).toBe(
    undefined,
  );
});

test("a session nobody has used for a year has run out", async ({ page }) => {
  const email = uniqueEmail("expired");
  await signUp(page, "Long Gone", email);
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  await db
    .update(schema.sessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.sessions.userId, user!.id));
  await page.reload();
  await expect(page).toHaveURL(/login/);
});
