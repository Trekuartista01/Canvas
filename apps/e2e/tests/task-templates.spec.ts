import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("save a task as a template, then create a new task from it", async ({ page }) => {
  test.setTimeout(60_000);

  await signUp(page, "Template Tester");
  await createWorkspaceAndOpen(page, "Template Workspace");
  const workspaceHomeUrl = page.url();
  await createSpaceAndList(page, "Ops", "Onboarding");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Set up new hire laptop");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Set up new hire laptop" }).click();

  const panel = page.getByTestId("task-detail-panel");
  await expect(panel.getByLabel("Task title")).toHaveValue("Set up new hire laptop");

  // Give the source task a checklist and a tag so the snapshot has
  // something beyond title/priority to prove it round-trips.
  await panel.getByLabel("Priority").selectOption("high");
  const checklistCreated = page.waitForResponse((res) => res.url().includes("checklist.create"));
  await panel.getByLabel("New checklist name").fill("Provisioning");
  await page.keyboard.press("Enter");
  await checklistCreated;
  const itemCreated = page.waitForResponse((res) => res.url().includes("items.create"));
  await panel.getByLabel("New checklist item text").fill("Install standard software");
  await page.keyboard.press("Enter");
  await itemCreated;
  await expect(panel.getByText("Install standard software")).toBeVisible();

  await page.getByRole("button", { name: "+ New tag" }).click();
  await page.getByLabel("New tag name").fill("it-onboarding");
  const tagCreated = page.waitForResponse((res) => res.url().includes("tag.create"));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await tagCreated;
  await expect(panel.getByText("it-onboarding")).toBeVisible();

  await page.getByRole("button", { name: "Save as template" }).click();
  await panel.getByLabel("Template name").fill("New hire onboarding");
  const templateCreated = page.waitForResponse((res) => res.url().includes("createFromTask"));
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await templateCreated;

  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Templates are workspace-scoped, browsable/deletable from workspace home.
  await page.goto(workspaceHomeUrl);
  await expect(page.getByText("New hire onboarding")).toBeVisible();

  // Back to the list; instantiate a second task from the template.
  await page.getByRole("link", { name: "Onboarding" }).click();
  await expect(page.getByRole("heading", { name: "# Onboarding" })).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();

  const instantiated = page.waitForResponse((res) => res.url().includes("instantiate"));
  await page.getByLabel("New from template").selectOption({ label: "New hire onboarding" });
  await instantiated;

  const spawnedCards = todoColumn.getByRole("button", { name: "Set up new hire laptop" });
  await expect(spawnedCards).toHaveCount(2);

  // The newer card (from the template) carries over priority/checklist/tag.
  await spawnedCards.nth(1).click();
  const spawnedPanel = page.getByTestId("task-detail-panel");
  await expect(spawnedPanel.getByLabel("Priority")).toHaveValue("high");
  await expect(spawnedPanel.getByText("Install standard software")).toBeVisible();
  await expect(spawnedPanel.getByText("it-onboarding")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Deleting the template removes it from the picker.
  await page.goto(workspaceHomeUrl);
  await page.getByRole("button", { name: "Delete template New hire onboarding" }).click();
  await expect(page.getByText("No templates yet")).toBeVisible();
});
