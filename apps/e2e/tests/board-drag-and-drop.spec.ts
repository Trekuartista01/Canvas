import { expect, test, type Locator, type Page } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

/**
 * Drags via a real mouse-move sequence (not a single jump) — dnd-kit's
 * PointerSensor needs incremental pointermove events past its activation
 * distance before it recognizes a drag, and a brief pause before release so
 * its collision detection settles on the final target.
 */
async function dragTaskOnto(page: Page, handle: Locator, target: Locator, verticalBias = 0.5) {
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) throw new Error("Could not measure drag source/target");

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height * verticalBias,
    { steps: 15 },
  );
  await page.waitForTimeout(100);

  // Registered before the drop so it can't miss a response that resolves
  // faster than we get around to awaiting it.
  const settled = page.waitForResponse((res) => res.url().includes("task.update"));
  await page.mouse.up();

  // Let the optimistic update's follow-up invalidate+refetch settle before
  // the next interaction — clicking mid-refetch can miss a DOM node that's
  // about to be replaced by the server-confirmed re-render.
  await settled;
  await page.waitForTimeout(200);
}

test("drag tasks across and within status columns on the board", async ({ page }) => {
  await signUp(page);
  await createWorkspaceAndOpen(page, "Board DnD Workspace");
  await createSpaceAndList(page, "Ops", "Kanban Test");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  const doneColumn = page.getByTestId("status-column-Completed");

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Design the invite");
  await page.keyboard.press("Enter");
  await expect(todoColumn.getByText("Design the invite")).toBeVisible();

  // --- drag across columns: To Do -> Done ---
  await dragTaskOnto(
    page,
    page.getByTestId("task-card-Design the invite").getByLabel("Drag to reorder"),
    doneColumn,
  );

  await expect(doneColumn.getByText("Design the invite")).toBeVisible();
  await expect(todoColumn.getByText("Design the invite")).toHaveCount(0);

  // --- drag within a column: reorder two tasks inside Done ---
  const doneCards = doneColumn.locator('[data-testid^="task-card-"]');

  await doneColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Print banners");
  await page.keyboard.press("Enter");
  await expect(doneCards).toHaveCount(2);
  await expect(doneCards.nth(0)).toHaveAttribute("data-testid", "task-card-Design the invite");
  await expect(doneCards.nth(1)).toHaveAttribute("data-testid", "task-card-Print banners");

  await dragTaskOnto(
    page,
    page.getByTestId("task-card-Print banners").getByLabel("Drag to reorder"),
    page.getByTestId("task-card-Design the invite"),
    0.1, // drop near the top of the target card = "insert before it"
  );

  await expect(doneCards.nth(0)).toHaveAttribute("data-testid", "task-card-Print banners");
  await expect(doneCards.nth(1)).toHaveAttribute("data-testid", "task-card-Design the invite");
});
