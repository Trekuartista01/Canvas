import { expect, test } from "@playwright/test";
import { createWorkspaceAndOpen, signUp } from "./helpers";

test("a task's status moves its card on the board; My Tasks opens it in place; Delete removes it", async ({
  page,
}) => {
  await signUp(page, "Olsi Owner");
  await createWorkspaceAndOpen(page, "Column Workspace");

  await page.getByRole("link", { name: "Boards", exact: true }).click();
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByPlaceholder(/board name/i).fill("Prishtina Mall");
  await page.keyboard.press("Enter");

  const todo = page.getByTestId("board-list-To Do");
  await expect(todo).toBeVisible();
  await todo.getByRole("button", { name: "+ Add a card" }).click();
  await page.getByPlaceholder("Task title").fill("Pitch Presentation");
  await page.keyboard.press("Enter");

  await page
    .getByTestId("board-card-Pitch Presentation")
    .getByRole("button", { name: "Pitch Presentation" })
    .click();
  const panel = page.getByTestId("task-detail-panel");
  await expect(panel).toBeVisible();

  // Status → column, while the panel stays open on the same task.
  const inProgress = page.getByTestId("board-list-In Progress");
  await panel.getByLabel("Status").selectOption({ label: "In progress" });
  await expect(inProgress.getByTestId("board-card-Pitch Presentation")).toBeVisible();
  await expect(todo.getByTestId("board-card-Pitch Presentation")).toHaveCount(0);
  await expect(panel.getByLabel("Task title")).toHaveValue("Pitch Presentation");
  await expect(panel.getByLabel("Status").locator("option:checked")).toHaveText("In progress");

  await panel.getByLabel("Assign someone").selectOption({ label: "Olsi Owner" });
  await expect(panel.getByRole("button", { name: "Remove Olsi Owner" })).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  // Opens over My Tasks, without leaving the page.
  await page.getByRole("link", { name: "My Tasks" }).click();
  await page
    .getByTestId("my-tasks-list")
    .getByRole("button", { name: /Pitch Presentation/ })
    .click();
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/my-tasks/);

  // No Work section any more; Delete asks first.
  await expect(panel.getByTestId("detail-group-Work")).toHaveCount(0);
  await panel.getByTestId("delete-task-button").click();
  await panel.getByRole("button", { name: "Keep it" }).click();
  await expect(panel.getByTestId("delete-task-confirm")).toHaveCount(0);
  await panel.getByTestId("delete-task-button").click();
  await panel.getByTestId("delete-task-confirm-button").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("my-tasks-empty")).toBeVisible();
});
