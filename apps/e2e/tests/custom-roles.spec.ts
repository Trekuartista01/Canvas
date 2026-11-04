import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  inviteAndGetLink,
  signUp,
  addEmailToAllBoards,
  openList,
  workspaceIdFrom,
} from "./helpers";

test("Phase 6: a custom role's grant and a space permission override each let a guest do something their base role normally can't", async ({
  page,
  browser,
}) => {
  await signUp(page, "Nia Owner");
  await createWorkspaceAndOpen(page, "Roles Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");

  // Invite Bob as a guest — guests can view a board but can't create tags
  // (tag:create) or tasks (task:create) by default.
  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, bobEmail, "guest");

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Guest", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByText("Roles Workspace", { exact: true })).toBeVisible();

  // Nia re-enters the workspace and creates a custom role based on "guest"
  // that grants tag:create.
  await page.getByRole("link", { name: "Open" }).click();
  await page.getByRole("link", { name: "Roles" }).click();
  await page.getByTestId("custom-role-name").fill("Tag Creator");
  await page.getByTestId("custom-role-base").selectOption("guest");
  await page.getByLabel("Grant tag:create").check();
  await page.getByTestId("custom-role-create").click();
  await expect(page.getByTestId("custom-role-list")).toContainText("Tag Creator");

  // Assign it to Bob from the members panel (on the workspace home page).
  // exact:true avoids matching the sidebar logo, whose aria-label ("Canvas
  // home") contains "home" as a case-insensitive substring too.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByLabel("Custom role for Bob Guest").selectOption({ label: "Tag Creator" });

  // Nia also adds a space override on Ops: guest -> task:create allowed.
  await page.getByRole("link", { name: "Roles" }).click();
  await page.getByTestId("space-override-space").selectOption({ label: "Ops" });
  await page.getByTestId("space-override-principal").selectOption("role:guest");
  await page.getByTestId("space-override-action").selectOption("task:create");
  await page.getByTestId("space-override-allow").selectOption("allow");
  await page.getByTestId("space-override-add").click();
  await expect(page.getByTestId("space-override-list")).toContainText("Guest");
  await expect(page.getByTestId("space-override-list")).toContainText("allowed");

  // Bob (still a guest) can now create a tag, thanks to the custom role's
  // grant: a real request, since Bob's own browser never saw Nia's edits.
  await bobPage.getByRole("link", { name: "Open" }).click();
  await bobPage.reload();
  const workspaceId = workspaceIdFrom(bobPage);
  const tag = await bobPage.request.post("/trpc/tag.create", {
    data: { workspaceId, name: "Guest tag", color: "#22c55e" },
  });
  expect(tag.ok()).toBe(true);

  // No custom role reaches board management (spec §10).
  await addEmailToAllBoards(workspaceId, bobEmail);
  const list = await bobPage.request.post("/trpc/hierarchy.space.create", {
    data: { workspaceId, name: "Guest board" },
  });
  expect(list.status()).toBe(403);

  // Bob can also create a task in Sprint, thanks to the space override.
  await openList(bobPage, "Ops", "Sprint");
  await bobPage.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = bobPage.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await bobPage.getByPlaceholder("Task title").fill("Guest-created task");
  await bobPage.keyboard.press("Enter");
  await expect(todoColumn.getByText("Guest-created task")).toBeVisible();

  // Removing the space override takes the permission away again.
  await page.getByRole("link", { name: "Roles" }).click();
  await page.getByTestId("space-override-list").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("space-override-list")).toHaveCount(0);
});
