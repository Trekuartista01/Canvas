import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, inviteAndGetLink, signUp } from "./helpers";

test("comment, @mention, react, and reply across two users; mentioned user gets a notification", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada Owner");
  await createWorkspaceAndOpen(page, "Collab Workspace");

  // back to the dashboard to invite a teammate
  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, bobEmail);

  // Bob signs up in a separate browser context (a real second user, not
  // just a second tab sharing Ada's session cookie) and accepts.
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Member", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByText("Collab Workspace", { exact: true })).toBeVisible();

  // Ada sets up the space/list/task
  await page.getByRole("link", { name: "Open" }).click();
  await createSpaceAndList(page, "Design", "Backlog");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Review homepage copy");
  await page.keyboard.press("Enter");

  // Bob navigates to the same list and opens the task
  await bobPage.getByRole("link", { name: "Open" }).click();
  await bobPage.getByRole("link", { name: "Backlog" }).click();
  await bobPage.getByRole("button", { name: "Board", exact: true }).click();
  await bobPage.getByRole("button", { name: "Review homepage copy" }).click();
  await expect(bobPage.getByLabel("Task title")).toHaveValue("Review homepage copy");

  // Bob posts a comment mentioning Ada
  const composer = bobPage.getByLabel("Write a comment… use @ to mention");
  await composer.click();
  await composer.pressSequentially("hey @Ada");
  await expect(bobPage.getByRole("button", { name: "Ada Owner" })).toBeVisible();
  await bobPage.getByRole("button", { name: "Ada Owner" }).click();
  await composer.pressSequentially(" can you take a look?");
  const commentPosted = bobPage.waitForResponse((res) => res.url().includes("comment.create"));
  await bobPage.getByRole("button", { name: "Comment", exact: true }).click();
  await commentPosted;
  await expect(bobPage.getByText("hey @Ada Owner  can you take a look?")).toBeVisible();

  // react to the comment and reply to it
  const reactionButton = bobPage.getByRole("button", { name: "React with 👍" });
  await reactionButton.click();
  await expect(reactionButton).toHaveText("👍 1");

  await bobPage.getByRole("button", { name: "Reply" }).click();
  const replyBox = bobPage.getByLabel("Write a reply…");
  await replyBox.click();
  await replyBox.pressSequentially("bumping this");
  const replyPosted = bobPage.waitForResponse((res) => res.url().includes("comment.create"));
  // the reply composer's Comment button renders before the ever-present
  // top-level composer's, which always sits last in the comments list
  await bobPage.getByRole("button", { name: "Comment", exact: true }).nth(0).click();
  await replyPosted;
  await expect(bobPage.getByText("bumping this")).toBeVisible();
  await expect(bobPage.getByText("Comments (2)")).toBeVisible();

  // Ada should have a notification for the mention
  await page.reload();
  await expect(page.getByLabel("Notifications")).toContainText("1");
  await page.getByLabel("Notifications").click();
  await expect(page.getByText("Bob Member mentioned you in a comment")).toBeVisible();
  await page.getByText("Bob Member mentioned you in a comment").click();

  // clicking the notification navigates to the task and opens its panel
  await expect(page.getByLabel("Task title")).toHaveValue("Review homepage copy");
  await expect(page.getByText("hey @Ada Owner  can you take a look?")).toBeVisible();

  // the notification is now read — the unread badge is gone
  await expect(page.getByLabel("Notifications")).not.toContainText("1");

  await bobContext.close();
});
