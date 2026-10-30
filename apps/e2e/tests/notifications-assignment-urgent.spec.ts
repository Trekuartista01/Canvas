import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, inviteAndGetLink, signUp } from "./helpers";

test("assigning a task notifies the assignee, and flagging it urgent notifies the whole workspace", async ({
  page,
  browser,
}) => {
  await signUp(page, "Nia Owner");
  await createWorkspaceAndOpen(page, "Notify Workspace");

  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-notify-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, bobEmail);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Member", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByRole("link", { name: "Open" })).toBeVisible();
  await bobPage.getByRole("link", { name: "Open" }).click();
  await expect(bobPage.getByLabel("Notifications")).toBeVisible();

  await page.getByRole("link", { name: "Open" }).click();
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Ship the launch email");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Ship the launch email" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Ship the launch email");

  // --- Assignment notifies the assignee ---
  const assigned = page.waitForResponse((res) => res.url().includes("assignees.add"));
  await page.getByLabel("Assign someone").selectOption({ label: "Bob Member" });
  await assigned;

  // Nia (the actor) gets no self-notification.
  await expect(page.getByLabel("Notifications")).not.toContainText("1");

  await bobPage.reload();
  await expect(bobPage.getByLabel("Notifications")).toContainText("1");
  await bobPage.getByLabel("Notifications").click();
  await expect(bobPage.getByText("Nia Owner assigned you a task")).toBeVisible();
  await bobPage.getByText("Nia Owner assigned you a task").click();
  await expect(bobPage.getByLabel("Task title")).toHaveValue("Ship the launch email");
  await expect(bobPage.getByLabel("Notifications")).not.toContainText("1");

  // Close the task panel so its backdrop doesn't reopen (via the lingering
  // `openTask` search param) and intercept clicks on the bell after reload.
  await bobPage.getByRole("button", { name: "Close task details" }).click();

  // --- Flagging the task urgent notifies every workspace member ---
  const urgentSet = page.waitForResponse((res) => res.url().includes("task.update"));
  await page.getByLabel("Priority").selectOption({ label: "Urgent" });
  await urgentSet;

  await expect(page.getByLabel("Notifications")).not.toContainText("1");

  await bobPage.reload();
  await expect(bobPage.getByLabel("Notifications")).toContainText("1");
  await bobPage.getByLabel("Notifications").click();
  await expect(bobPage.getByText("Nia Owner flagged a task as urgent")).toBeVisible();
  await bobPage.getByText("Nia Owner flagged a task as urgent").click();
  await expect(bobPage.getByLabel("Task title")).toHaveValue("Ship the launch email");

  await bobContext.close();
});
