import { expect, test } from "@playwright/test";
import { createWorkspaceAndOpen, signUp } from "./helpers";

test("a custom role created in one workspace is usable in every other workspace its creator belongs to — but not elsewhere", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Nia Owner");
  await createWorkspaceAndOpen(page, "Studio A");

  // Nia creates "Video Editor" in Studio A.
  await page.getByRole("link", { name: "Roles" }).click();
  await page.getByTestId("custom-role-name").fill("Video Editor");
  await page.getByTestId("custom-role-base").selectOption("member");
  await page.getByTestId("custom-role-create").click();
  await expect(page.getByTestId("custom-role-list")).toContainText("Video Editor");

  // Nia creates a second workspace, Studio B — same person, same team, just
  // separate work. The role should already be there, not redefined. (Not
  // using the createWorkspaceAndOpen helper here since it assumes a single
  // "Open" link on the picker page — Nia now has two workspaces.)
  await page.getByRole("link", { name: "All workspaces" }).click();
  await page.getByRole("link", { name: "New workspace" }).click();
  await page.getByLabel("Workspace name").fill("Studio B");
  await page.getByRole("button", { name: "Create workspace" }).click();
  const studioBRow = page.locator("li", { hasText: "Studio B" });
  await studioBRow.getByRole("link", { name: "Open" }).click();

  await page.getByRole("link", { name: "Roles" }).click();
  await expect(page.getByTestId("custom-role-list")).toContainText("Video Editor");

  // It's assignable from Studio B's invite form too, not just visible on
  // the Roles page.
  await page.getByRole("link", { name: "All workspaces" }).click();
  await expect(
    studioBRow.getByLabel("Invite role").locator("option", { hasText: "Video Editor" }),
  ).toHaveCount(1);

  // A completely unrelated owner (no shared membership with Nia anywhere)
  // never sees it — proves this is real account-level scoping, not a
  // global list of every role that exists.
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await signUp(outsiderPage, "Outside Owner");
  await createWorkspaceAndOpen(outsiderPage, "Unrelated Workspace");
  await outsiderPage.getByRole("link", { name: "Roles" }).click();
  // Nothing shared with Nia anywhere, so the whole list is empty — not
  // rendered at all (see roles.tsx), rather than rendered-but-missing-this-
  // one-role.
  await expect(outsiderPage.getByTestId("custom-role-list")).toHaveCount(0);
  await expect(outsiderPage.getByText("Video Editor")).toHaveCount(0);
  await outsiderContext.close();

  // Inviting Bob into Studio B directly with "Video Editor" applies it.
  const bobEmail = `bob-role-share-${Date.now()}@example.com`;
  await studioBRow.getByPlaceholder("teammate@example.com").fill(bobEmail);
  await studioBRow.getByLabel("Invite role").selectOption({ label: "Video Editor" });
  await studioBRow.getByRole("button", { name: "Invite", exact: true }).click();
  const link = studioBRow.locator("p", { hasText: "Invite link:" }).locator("span");
  await expect(link).toBeVisible();
  const inviteLink = await link.textContent();
  if (!inviteLink) throw new Error("Invite link was empty");

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Editor", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByRole("link", { name: "Open" })).toBeVisible();
  await bobContext.close();
});
