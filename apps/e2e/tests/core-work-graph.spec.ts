import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("sign up, build a workspace hierarchy, and manage tasks across board + list views", async ({
  page,
}) => {
  // --- M0.2: sign up, create + open a workspace ---
  await signUp(page);
  await createWorkspaceAndOpen(page, "E2E Workspace");

  // --- M1.1: create a space, then a list directly under it ---
  await createSpaceAndList(page, "Engineering", "Sprint Board");

  // --- M1.2: default statuses were seeded, add a task via the board view ---
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await expect(todoColumn).toBeVisible();
  await expect(page.getByTestId("status-column-In progress")).toBeVisible();
  await expect(page.getByTestId("status-column-Completed")).toBeVisible();

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Ship the launch email");
  await page.keyboard.press("Enter");
  await expect(todoColumn.getByText("Ship the launch email")).toBeVisible();

  // --- M1.3: the same task shows up in the list view ---
  await page.getByRole("button", { name: "List", exact: true }).click();
  const titleCell = page.getByRole("button", { name: "Ship the launch email" });
  await expect(titleCell).toBeVisible();

  // inline title edit
  await titleCell.click();
  const titleInput = page.locator("input:focus");
  await titleInput.fill("Ship the launch email v2");
  await titleInput.press("Enter");
  await expect(page.getByRole("button", { name: "Ship the launch email v2" })).toBeVisible();

  // group by status
  await page.getByRole("button", { name: /Group by status/ }).click();
  await expect(page.getByText("Pending (1)")).toBeVisible();

  // search filters the task out
  await page.getByPlaceholder("Search titles…").fill("no such task");
  await expect(page.getByText("0 tasks")).toBeVisible();
  await page.getByPlaceholder("Search titles…").fill("");
  await expect(page.getByText("1 task", { exact: true })).toBeVisible();
});
