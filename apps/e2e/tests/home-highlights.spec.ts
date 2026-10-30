import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("Home: Top priority surfaces urgent + assigned-to-me tasks, Recently added shows new tasks", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Home Tester");
  await createWorkspaceAndOpen(page, "Home Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Normal task");
  await page.keyboard.press("Enter");

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Urgent task");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Urgent task" }).click();
  const urgentSet = page.waitForResponse((res) => res.url().includes("task.update"));
  await page.getByLabel("Priority").selectOption({ label: "Urgent" });
  await urgentSet;
  await page.getByRole("button", { name: "Close task details" }).click();

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Assigned to me task");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Assigned to me task" }).click();
  const assigned = page.waitForResponse((res) => res.url().includes("assignees.add"));
  await page.getByLabel("Assign someone").selectOption({ label: "Home Tester" });
  await assigned;
  await page.getByRole("button", { name: "Close task details" }).click();

  await page.getByRole("link", { name: "Home", exact: true }).click();

  const topPriority = page.getByTestId("home-top-priority");
  await expect(topPriority.getByText("Urgent task")).toBeVisible();
  await expect(topPriority.getByText("Assigned to me task")).toBeVisible();
  await expect(topPriority.getByText("Normal task")).not.toBeVisible();

  // Recently added excludes anything already surfaced in Top priority —
  // otherwise a task that's both urgent and new would show up twice.
  const recent = page.getByTestId("home-recently-added");
  await expect(recent.getByText("Normal task")).toBeVisible();
  await expect(recent.getByText("Urgent task")).not.toBeVisible();
  await expect(recent.getByText("Assigned to me task")).not.toBeVisible();

  // Clicking a highlight navigates to the task in its list.
  await topPriority.getByText("Urgent task").click();
  await expect(page.getByLabel("Task title")).toHaveValue("Urgent task");
});

test("Login summary: shows once right after logging in, not on a later reload", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const email = await signUp(page, "Login Summary Tester");
  await createWorkspaceAndOpen(page, "Login Summary Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Urgent onboarding task");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Urgent onboarding task" }).click();
  const urgentSet = page.waitForResponse((res) => res.url().includes("task.update"));
  await page.getByLabel("Priority").selectOption({ label: "Urgent" });
  await urgentSet;
  await page.getByRole("button", { name: "Close task details" }).click();

  // No summary yet on this same session (signup, not a fresh login).
  await expect(page.getByTestId("login-summary-panel")).not.toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("e2e-test-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Open" }).click();

  const summary = page.getByTestId("login-summary-panel");
  await expect(summary).toBeVisible();
  await expect(summary.getByText("Urgent onboarding task")).toBeVisible();

  await summary.getByRole("button", { name: "Close", exact: true }).click();
  await expect(summary).not.toBeVisible();

  // A reload (not a fresh login) doesn't bring it back.
  await page.reload();
  await expect(page.getByTestId("login-summary-panel")).not.toBeVisible();
});
