import { db, schema } from "@canvas/db";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  createWorkspaceAndOpen,
  inviteAndGetLink,
  signUp,
  uniqueEmail,
  workspaceIdFrom,
} from "./helpers";

test("the account page shows and saves work details, separately for each workspace", async ({
  page,
}) => {
  await signUp(page, "Asha Account");
  await createWorkspaceAndOpen(page, "Account First");
  await page.getByRole("link", { name: "All workspaces" }).click();
  await page.getByRole("link", { name: "New workspace" }).click();
  await page.getByLabel("Workspace name").fill("Account Second");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page.getByRole("link", { name: "Account settings" })).toBeVisible();

  // From the bottom left of a workspace.
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(page).toHaveURL(/\/account$/);

  const first = page
    .getByTestId("work-profile")
    .filter({ hasText: "Your profile in Account First" });
  const second = page
    .getByTestId("work-profile")
    .filter({ hasText: "Your profile in Account Second" });
  const position = `Art Director ${Date.now()}`;
  await first.getByLabel("Position").fill(position);
  await first.getByLabel("Department").selectOption("Motion");
  await first.getByLabel("Birthday").fill("1990-07-21");
  await first.getByLabel("Phone", { exact: true }).fill("+383 44 111 222");
  await first.getByLabel("Address").fill("Rruga Agim Ramadani 1");
  await first.getByLabel("Emergency contact name").fill("Besa");
  await first.getByLabel("Emergency contact phone").fill("+383 44 333 444");
  await expect(first.getByLabel("Department").locator("option")).toHaveText([
    "Not set",
    "Design",
    "Motion",
    "Development",
    "HR/Finance",
    "CEO",
    "Operations",
  ]);
  const saved = page.waitForResponse((res) => res.url().includes("people.updateMyProfile"));
  await first.getByRole("button", { name: "Save my details" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(first.getByText("Saved")).toBeVisible();

  await page.reload();
  await expect(first.getByLabel("Position")).toHaveValue(position);
  await expect(first.getByLabel("Department")).toHaveValue("Motion");
  await expect(first.getByLabel("Birthday")).toHaveValue("1990-07-21");
  await expect(first.getByLabel("Phone", { exact: true })).toHaveValue("+383 44 111 222");
  await expect(first.getByLabel("Address")).toHaveValue("Rruga Agim Ramadani 1");
  await expect(first.getByLabel("Emergency contact name")).toHaveValue("Besa");
  await expect(first.getByLabel("Emergency contact phone")).toHaveValue("+383 44 333 444");
  await expect(second.getByLabel("Position")).toHaveValue("");
  await expect(second.getByLabel("Phone", { exact: true })).toHaveValue("");

  // A department from before the list stays put when saving something else.
  await db
    .update(schema.employeeProfiles)
    .set({ department: "Old Team" })
    .where(eq(schema.employeeProfiles.jobTitle, position));
  await page.reload();
  await expect(first.getByLabel("Department")).toHaveValue("Old Team");
  await first.getByLabel("Address").fill("Rruga Agim Ramadani 2");
  const resaved = page.waitForResponse((res) => res.url().includes("people.updateMyProfile"));
  await first.getByRole("button", { name: "Save my details" }).click();
  expect((await resaved).ok()).toBe(true);
  await page.reload();
  await expect(first.getByLabel("Department")).toHaveValue("Old Team");
  await expect(first.getByLabel("Address")).toHaveValue("Rruga Agim Ramadani 2");

  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByTestId("reset-my-password").getByRole("status")).toContainText(
    "Check your email",
  );

  // From the workspaces page too.
  await page.getByRole("link", { name: "← Back" }).click();
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(first.getByLabel("Position")).toHaveValue(position);
});

test("people set their own position, department and birthday, and can email themselves a reset link", async ({
  page,
  browser,
}) => {
  await signUp(page, "Owner Viewer");
  await createWorkspaceAndOpen(page, "My Profile Workspace");
  const workspaceId = workspaceIdFrom(page);
  await page.getByRole("link", { name: "All workspaces" }).click();
  const email = uniqueEmail("my-profile");
  const link = await inviteAndGetLink(page, email);

  const context = await browser.newContext();
  const member = await context.newPage();
  await signUp(member, "Mira Member", email);
  await member.goto(link);
  await member.getByRole("button", { name: /Accept & join/ }).click();
  await expect(member.getByRole("link", { name: "Open" })).toBeVisible();
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const profilePath = `/w/${workspaceId}/people/${user!.id}`;

  await member.goto(profilePath);
  const editor = member.getByTestId("my-details-editor");
  await editor.getByLabel("Position").fill("Graphic Designer");
  await editor.getByLabel("Department").selectOption("Design");
  await editor.getByLabel("Birthday").fill("1995-03-14");
  await editor.getByLabel("Phone", { exact: true }).fill("+383 49 555 666");
  const saved = member.waitForResponse((res) => res.url().includes("people.updateMyProfile"));
  await member.getByRole("button", { name: "Save my details" }).click();
  expect((await saved).ok()).toBe(true);

  await member.reload();
  const details = member.getByTestId("person-details");
  await expect(details).toContainText("Graphic Designer");
  await expect(details).toContainText("Design");
  await expect(details).toContainText("Date of birth");

  // Someone else sees the position and department, but not the birthday or these controls.
  await page.goto(profilePath);
  const seen = page.getByTestId("person-details");
  await expect(seen).toContainText("Graphic Designer");
  await expect(seen).not.toContainText("Date of birth");
  await expect(seen).not.toContainText("+383 49 555 666");
  await expect(page.getByTestId("my-details-editor")).toHaveCount(0);
  await expect(page.getByTestId("reset-my-password")).toHaveCount(0);

  // The reset button sends the same link as "Forgot password", and it works.
  await member.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(member.getByTestId("reset-my-password").getByRole("status")).toContainText(
    "Check your email",
  );
  const res = await member.request.get(`/test-hooks/reset-link?email=${encodeURIComponent(email)}`);
  const { path } = (await res.json()) as { path: string };
  await member.goto(path);
  await member
    .getByLabel(/new password/i)
    .first()
    .fill("a-brand-new-password-1");
  await context.close();
});
