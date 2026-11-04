import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

const OLD_PASSWORD = "e2e-test-password";
const NEW_PASSWORD = "a-brand-new-password";

async function requestReset(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByTestId("reset-sent")).toContainText(email);
}

/** The link that would have been emailed. It's sent after responding, so wait. */
async function resetLink(request: APIRequestContext, email: string, notThis?: string) {
  let path = "";
  await expect
    .poll(async () => {
      const res = await request.get(`/test-hooks/reset-link?email=${encodeURIComponent(email)}`);
      if (!res.ok()) return false;
      path = ((await res.json()) as { path: string }).path;
      return path !== notThis;
    })
    .toBe(true);
  return path;
}

function logInStatus(request: APIRequestContext, email: string, password: string) {
  return request
    .post("/trpc/auth.logIn", { data: { email, password } })
    .then((res) => res.status());
}

test("forgot password: an emailed link sets a new one and signs out every device", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  const email = await signUp(page, "Rina Reset");

  // A device that's logged in the whole time.
  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();

  await requestReset(visitor, email);
  const first = await resetLink(visitor.request, email);

  // Addresses with no account get the same screen, and no link.
  const nobody = uniqueEmail("nobody");
  await requestReset(visitor, nobody);
  await visitor.waitForTimeout(500);
  const noLink = await visitor.request.get(
    `/test-hooks/reset-link?email=${encodeURIComponent(nobody)}`,
  );
  expect(noLink.status()).toBe(404);
  await requestReset(visitor, "someone@gmail.com");

  // Asking again replaces the link.
  await requestReset(visitor, email);
  const link = await resetLink(visitor.request, email, first);
  await visitor.goto(first);
  await expect(visitor.getByTestId("reset-link-invalid")).toContainText(
    "expired or was already used",
  );

  // Asking for a reset changes nothing until the link is used.
  expect(await logInStatus(anonymous.request, email, OLD_PASSWORD)).toBe(200);

  await visitor.goto(link);
  await expect(visitor.getByText(email)).toBeVisible();
  await visitor.locator("#password").fill(NEW_PASSWORD);
  await visitor.getByRole("button", { name: "Save new password" }).click();
  await expect(visitor).toHaveURL(/\/login/);
  await expect(visitor.getByTestId("password-reset-done")).toBeVisible();

  // Every device is signed out, including the one that stayed logged in.
  await page.reload();
  await expect(page).toHaveURL(/\/login/);

  // The old password is gone and the new one works.
  expect(await logInStatus(anonymous.request, email, OLD_PASSWORD)).toBe(401);
  await visitor.locator("#email").fill(email);
  await visitor.locator("#password").fill(NEW_PASSWORD);
  await visitor.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(visitor).not.toHaveURL(/\/login/);

  // A link works once.
  const other = await (await browser.newContext()).newPage();
  await other.goto(link);
  await expect(other.getByTestId("reset-link-invalid")).toBeVisible();
  const replay = await other.request.post("/trpc/auth.completePasswordReset", {
    data: {
      token: new URL(link, "http://x").searchParams.get("token"),
      password: "hacked-password",
    },
  });
  expect(replay.status()).toBe(404);
  expect(await logInStatus(other.request, email, "hacked-password")).toBe(401);
});

test("rate limits: emails to one address and repeated wrong passwords are cut off", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // Five emails an hour per address, whether or not it has an account.
  for (const [path, build] of [
    ["auth.requestPasswordReset", (email: string) => ({ email })],
    ["auth.signUp", (email: string) => ({ email, name: "Flood" })],
  ] as const) {
    const target = uniqueEmail("flood");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await page.request.post(`/trpc/${path}`, { data: build(target) });
      statuses.push(res.status());
    }
    expect(statuses, path).toEqual([200, 200, 200, 200, 200, 429]);
  }

  // Twenty wrong passwords an hour per address and IP, then even the right one waits.
  const email = await signUp(page, "Lockout Target");
  for (let i = 0; i < 20; i++) {
    expect(await logInStatus(page.request, email, `wrong-password-${i}`)).toBe(401);
  }
  expect(await logInStatus(page.request, email, "wrong-password-again")).toBe(429);
  expect(await logInStatus(page.request, email, OLD_PASSWORD)).toBe(429);

  // A successful login beforehand doesn't count against anyone: other people are fine.
  const someoneElse = await page.request.post("/trpc/auth.logIn", {
    data: { email: uniqueEmail("other"), password: "not-their-password" },
  });
  expect(someoneElse.status()).toBe(401);
});

test("Google sign-in is gone", async ({ page }) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /log in|sign up/i }).first()).toBeVisible();
    await expect(page.getByText(/google/i)).toHaveCount(0);
  }
  const route = await page.request.get("http://localhost:3001/auth/google", { maxRedirects: 0 });
  expect(route.status()).toBe(404);
});
