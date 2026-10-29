import { expect, test } from "@playwright/test";
import { createWorkspaceAndOpen, inviteAndGetLink, signUp, uniqueEmail } from "./helpers";

test("Admin page: status, AI quota, backups, and audit log for workspace owner", async ({
  page,
}) => {
  await signUp(page, "Admin Tester");
  await createWorkspaceAndOpen(page, "Admin Workspace");

  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page.getByTestId("admin-page")).toBeVisible();

  await expect(page.getByTestId("admin-status")).toBeVisible();
  await expect(page.getByTestId("admin-status").getByText("Overall")).toBeVisible();
  await expect(page.getByTestId("admin-status").getByText("ok").first()).toBeVisible();

  await expect(page.getByTestId("admin-ai-quota")).toContainText("Brain messages today");
  await expect(page.getByTestId("admin-ai-quota")).toContainText("/ 50");
  await expect(page.getByTestId("admin-ai-quota")).toContainText("/ 20");
  await expect(page.getByTestId("admin-ai-quota")).toContainText("$50");

  await expect(page.getByTestId("admin-backups")).toContainText("pg_dump");
  await expect(page.getByTestId("admin-audit")).toBeVisible();
});

test("Admin is hidden from regular members (nav + deep link)", async ({ page, browser }) => {
  await signUp(page, "Owner Admin Gate");
  await createWorkspaceAndOpen(page, "Gate Workspace");
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "All workspaces" }).click();
  const staffEmail = uniqueEmail("staff");
  const inviteLink = await inviteAndGetLink(page, staffEmail, undefined);

  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await signUp(staff, "Staff Member", staffEmail);
  await staff.goto(inviteLink);
  await staff.getByRole("button", { name: /Accept & join/ }).click();
  await staff.getByRole("link", { name: "Open" }).click();

  await expect(staff.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await expect(staff.getByRole("link", { name: "Roles", exact: true })).toHaveCount(0);

  const url = staff.url();
  const match = url.match(/\/w\/([^/]+)/);
  expect(match).toBeTruthy();
  await staff.goto(`/w/${match![1]}/admin`);
  await expect(staff.getByTestId("admin-page")).toHaveCount(0);
  await expect(staff).toHaveURL(new RegExp(`/w/${match![1]}/?$`));

  await staffCtx.close();
});
