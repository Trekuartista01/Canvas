import { expect, test } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  inviteAndGetLink,
  setPeopleRole,
  signUp,
} from "./helpers";

test("making a member an Operations Manager notifies them when a task is finished via the Finish button", async ({
  page,
  browser,
}) => {
  await signUp(page, "Nia Owner");
  await createWorkspaceAndOpen(page, "Ops Notify Workspace");

  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-ops-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, bobEmail);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Ops", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByRole("link", { name: "Open" })).toBeVisible();
  await bobPage.getByRole("link", { name: "Open" }).click();
  await expect(bobPage.getByLabel("Notifications")).toBeVisible();

  // Nia makes Bob an Operations Manager (M7.1: a people role, set from his
  // People profile) — that's who hears about finished tasks.
  await page.getByRole("link", { name: "Open" }).click();
  await setPeopleRole(page, bobEmail, "operation_manager");

  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-To Do");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Ship the launch email");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Ship the launch email" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Ship the launch email");

  // --- The explicit Finish button, not a board drag ---
  const finishButton = page.getByTestId("finish-task-button");
  await expect(finishButton).toBeVisible();
  const finished = page.waitForResponse((res) => res.url().includes("task.update"));
  await finishButton.click();
  await finished;
  await expect(finishButton).toHaveCount(0); // already finished, button disappears

  await bobPage.reload();
  await expect(bobPage.getByLabel("Notifications")).toContainText("1");
  await bobPage.getByLabel("Notifications").click();
  const finishedNotification = bobPage.getByText(/Nia Owner\s*finished\s*.Ship the launch email./);
  await expect(finishedNotification).toBeVisible();
  await finishedNotification.click();
  await expect(bobPage.getByLabel("Task title")).toHaveValue("Ship the launch email");
  await bobContext.close();
});
