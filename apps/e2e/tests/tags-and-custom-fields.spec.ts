import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("add a tag and custom fields to a task, and verify both persist", async ({ page }) => {
  await signUp(page, "Tag Tester");
  await createWorkspaceAndOpen(page, "Tag Workspace");
  await createSpaceAndList(page, "Design", "Sprint");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Design homepage");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Design homepage" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Design homepage");

  // create a brand-new tag and assign it in one flow
  await page.getByRole("button", { name: "+ New tag" }).click();
  await page.getByLabel("New tag name").fill("frontend");
  await page.getByLabel("Color #3b82f6").click();
  const tagCreated = page.waitForResponse((res) => res.url().includes("tag.create"));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await tagCreated;
  await expect(page.getByText("frontend")).toBeVisible();

  // add a dropdown custom field and set its value
  await page.getByRole("button", { name: "+ Add field" }).click();
  await page.getByLabel("New field name").fill("Priority Level");
  await page.getByLabel("New field type").selectOption({ label: "Dropdown" });
  await page.getByLabel("New field options").fill("Low, Medium, High");
  const dropdownDefCreated = page.waitForResponse((res) => res.url().includes("defs.create"));
  await page.getByRole("button", { name: "Add field" }).click();
  await dropdownDefCreated;

  const priorityDropdownSet = page.waitForResponse((res) => res.url().includes("values.set"));
  await page.getByLabel("Priority Level").selectOption("Medium");
  await priorityDropdownSet;

  // add a checkbox custom field and check it
  await page.getByRole("button", { name: "+ Add field" }).click();
  await page.getByLabel("New field name").fill("Approved");
  await page.getByLabel("New field type").selectOption({ label: "Checkbox" });
  const checkboxDefCreated = page.waitForResponse((res) => res.url().includes("defs.create"));
  await page.getByRole("button", { name: "Add field" }).click();
  await checkboxDefCreated;

  const approvedSet = page.waitForResponse((res) => res.url().includes("values.set"));
  await page.getByLabel("Approved").check();
  await approvedSet;

  // reload and reopen to confirm everything persisted server-side
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Design homepage" }).click();

  await expect(page.getByText("frontend")).toBeVisible();
  await expect(page.getByLabel("Priority Level")).toHaveValue("Medium");
  await expect(page.getByLabel("Approved")).toBeChecked();

  // remove the tag
  const tagRemoved = page.waitForResponse((res) => res.url().includes("tags.remove"));
  await page.getByRole("button", { name: "Remove tag frontend" }).click();
  await tagRemoved;
  // the tag itself still exists workspace-wide (selectable again from "Add
  // existing tag") — only its pill on this task is gone
  await expect(page.getByRole("button", { name: "Remove tag frontend" })).toHaveCount(0);
});
