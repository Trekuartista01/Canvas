import { db, schema } from "@canvas/db";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createWorkspaceAndOpen, signUp, uniqueEmail, workspaceIdFrom } from "./helpers";

test("the inviter chooses the role, it applies on joining, and an invite can be cancelled", async ({
  page,
  browser,
}) => {
  await signUp(page, "Owner Picks");
  await createWorkspaceAndOpen(page, "Invite Choice Workspace");
  const workspaceId = workspaceIdFrom(page);
  await page.getByRole("link", { name: "All workspaces" }).click();

  // A wrong invite can be taken back: its link stops working.
  const cancelled = uniqueEmail("cancelled");
  await page.getByPlaceholder("teammate@example.com").fill(cancelled);
  await page.getByLabel("Invite role").selectOption({ label: "CEO" });
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const link = page.locator("p", { hasText: "Invite link:" }).locator("span");
  await expect(link).toBeVisible();
  const cancelledLink = (await link.textContent())!;
  const pending = page.getByTestId("pending-invites");
  await expect(pending).toContainText(cancelled);
  await expect(pending).toContainText("CEO");
  await pending.getByRole("button", { name: "Cancel invite" }).click();
  await expect(pending).toBeHidden();
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(cancelledLink);
  await expect(strangerPage.getByText("no longer valid")).toBeVisible();
  await stranger.close();

  // Someone new joins as what the inviter chose, without being asked.
  const email = uniqueEmail("ops-invited");
  await page.getByPlaceholder("teammate@example.com").fill(email);
  await page.getByLabel("Invite role").selectOption({ label: "Operations Manager" });
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByTestId("pending-invites")).toContainText(email);
  const inviteLink = (await link.textContent())!;

  const context = await browser.newContext();
  const invited = await context.newPage();
  await signUp(invited, "Olive Ops", email);
  await invited.goto(inviteLink);
  await expect(invited.getByTestId("invite-role")).toHaveText("You'll join as Operations Manager.");
  await expect(invited.getByLabel("Your role")).toHaveCount(0);
  await invited.getByRole("button", { name: /Accept & join/ }).click();
  await expect(invited.getByRole("link", { name: "Open" })).toBeVisible();

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(schema.memberships.workspaceId, workspaceId),
      eq(schema.memberships.userId, user!.id),
    ),
  });
  expect(membership?.peopleRole).toBe("operations_manager");
  await context.close();

  // Already in the workspace: the role is changed in Directory, not by a new invite.
  await page.reload();
  await page.getByPlaceholder("teammate@example.com").fill(email);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("already in this workspace");
});
