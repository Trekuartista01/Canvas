import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("open a task's detail panel and edit priority, dates, description, and assignees", async ({
  page,
}) => {
  await signUp(page, "Detail Panel Tester");
  await createWorkspaceAndOpen(page, "Detail Panel Workspace");
  await createSpaceAndList(page, "Design", "Assets");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Draft brand guidelines");
  await page.keyboard.press("Enter");

  // open the detail panel from the board card
  await page.getByRole("button", { name: "Draft brand guidelines" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Draft brand guidelines");

  // priority
  await page.getByLabel("Priority").selectOption("high");
  await expect(page.getByLabel("Priority")).toHaveValue("high");

  // dates — fill() on a native date input accepts an ISO value directly
  await page.getByLabel("Start date").fill("2026-07-01");
  await page.getByLabel("Due date").fill("2026-07-15");

  // description (TipTap contenteditable)
  const description = page.getByLabel("Description");
  await description.click();
  await description.fill("Keep it under 20 pages.");
  const savedDescription = page.waitForResponse((res) => res.url().includes("task.update"));
  await page.getByLabel("Task title").click(); // moves focus away, triggering the editor's onBlur save
  await savedDescription;

  // assign the current user (workspace owner is a member of their own workspace)
  const assigned = page.waitForResponse((res) => res.url().includes("assignees.add"));
  await page.getByLabel("Assign someone").selectOption({ label: "Detail Panel Tester" });
  await assigned;
  const removeAssigneeButton = page.getByRole("button", { name: "Remove Detail Panel Tester" });
  await expect(removeAssigneeButton).toBeVisible();

  // reload and reopen to confirm everything actually persisted server-side,
  // not just optimistically in the open panel
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Draft brand guidelines" }).click();

  await expect(page.getByLabel("Priority")).toHaveValue("high");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-07-01");
  await expect(page.getByLabel("Due date")).toHaveValue("2026-07-15");
  await expect(page.getByLabel("Description")).toContainText("Keep it under 20 pages.");
  await expect(removeAssigneeButton).toBeVisible();

  // remove the assignee
  await removeAssigneeButton.click();
  await expect(removeAssigneeButton).toHaveCount(0);
});
