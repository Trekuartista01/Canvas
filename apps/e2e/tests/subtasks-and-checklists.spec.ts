import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("add a subtask and a checklist to a task, and verify both persist", async ({ page }) => {
  await signUp(page, "Subtask Tester");
  await createWorkspaceAndOpen(page, "Subtask Workspace");
  await createSpaceAndList(page, "Marketing", "Sprint");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Launch campaign");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Launch campaign" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Launch campaign");

  // add a subtask
  const subtaskCreated = page.waitForResponse((res) => res.url().includes("task.create"));
  await page.getByLabel("New subtask").fill("Design mockups");
  await page.keyboard.press("Enter");
  await subtaskCreated;
  await expect(page.getByRole("button", { name: "Design mockups" })).toBeVisible();

  // the subtask must not appear as its own card on the board
  await expect(page.getByRole("button", { name: "Design mockups", exact: true })).toHaveCount(1);
  await expect(todoColumn).not.toContainText("Design mockups");

  // add a checklist with one item
  const checklistCreated = page.waitForResponse((res) => res.url().includes("checklist.create"));
  await page.getByLabel("New checklist name").fill("Review checklist");
  await page.keyboard.press("Enter");
  await checklistCreated;

  const itemCreated = page.waitForResponse((res) => res.url().includes("items.create"));
  await page.getByLabel("New checklist item text").fill("Check contrast");
  await page.keyboard.press("Enter");
  await itemCreated;
  await expect(page.getByText("Review checklist")).toBeVisible();
  await expect(page.getByText("0/1")).toBeVisible();

  // check the item off — a plain click, not .check(), since the checkbox is
  // controlled by server state and its actual toggle is confirmed below via
  // a web-first assertion rather than .check()'s own (stricter, synchronous)
  // verification.
  const itemChecked = page.waitForResponse((res) => res.url().includes("items.update"));
  await page.getByRole("checkbox", { name: "Check contrast" }).click();
  await itemChecked;
  await expect(page.getByRole("checkbox", { name: "Check contrast" })).toBeChecked();
  await expect(page.getByText("1/1")).toBeVisible();

  // opening the subtask must not offer to add a further subtask (depth cap of 2)
  await page.getByRole("button", { name: "Design mockups" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Design mockups");
  await expect(page.getByLabel("New subtask")).toHaveCount(0);

  // reload and reopen the parent to confirm everything persisted server-side
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Launch campaign" }).click();

  await expect(page.getByRole("button", { name: "Design mockups" })).toBeVisible();
  await expect(page.getByText("1/1")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Check contrast" })).toBeChecked();
});
