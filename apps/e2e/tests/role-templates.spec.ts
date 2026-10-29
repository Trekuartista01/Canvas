import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, inviteAndGetLink, signUp } from "./helpers";

test("Role templates: Staff can't create tasks or see Platform pages; Finance Manager unlocks the Timesheet team overview", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  await signUp(page, "Owner Tester");
  await createWorkspaceAndOpen(page, "Templates Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");

  // Invite Bob and Carol as plain members — they'll get custom roles after.
  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-staff-${Date.now()}@example.com`;
  const bobInvite = await inviteAndGetLink(page, bobEmail);
  const carolEmail = `carol-finance-${Date.now()}@example.com`;
  const carolInvite = await inviteAndGetLink(page, carolEmail);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Staff", bobEmail);
  await bobPage.goto(bobInvite);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();

  const carolContext = await browser.newContext();
  const carolPage = await carolContext.newPage();
  await signUp(carolPage, "Carol Finance", carolEmail);
  await carolPage.goto(carolInvite);
  await carolPage.getByRole("button", { name: /Accept & join/ }).click();

  // Owner creates the two role templates.
  await page.getByRole("link", { name: "Open" }).click();
  await page.getByRole("link", { name: "Roles" }).click();
  await page.getByTestId("role-template-staff").click();
  await expect(page.getByTestId("custom-role-name")).toHaveValue("Staff");
  await page.getByTestId("custom-role-create").click();
  await expect(page.getByTestId("custom-role-list")).toContainText("Staff");

  await page.getByTestId("role-template-finance-manager").click();
  await expect(page.getByTestId("custom-role-name")).toHaveValue("Finance Manager");
  await page.getByTestId("custom-role-create").click();
  await expect(page.getByTestId("custom-role-list")).toContainText("Finance Manager");

  // Assign the templates from the Home page's Members panel.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByLabel("Custom role for Bob Staff").selectOption({ label: "Staff" });
  await page.getByLabel("Custom role for Carol Finance").selectOption({ label: "Finance Manager" });

  // Bob (Staff): Platform nav is hidden, Brand Kits (Collaborate) is visible,
  // and creating a task silently fails to appear.
  await bobPage.getByRole("link", { name: "Open" }).click();
  await expect(bobPage.getByRole("link", { name: "Brand Kits", exact: true })).toBeVisible();
  await expect(bobPage.getByRole("link", { name: "Roles" })).not.toBeVisible();
  await expect(bobPage.getByRole("link", { name: "Admin", exact: true })).not.toBeVisible();

  await bobPage.getByRole("link", { name: "Sprint" }).click();
  await bobPage.getByRole("button", { name: "Board", exact: true }).click();
  const bobTodoColumn = bobPage.getByTestId("status-column-To Do");
  await bobTodoColumn.getByRole("button", { name: "+ Add task" }).click();
  await bobPage.getByPlaceholder("Task title").fill("Staff task");
  await bobPage.keyboard.press("Enter");
  await expect(bobTodoColumn.getByText("Staff task")).not.toBeVisible();

  // Bob (Staff) has no timeEntry:viewAll — no team overview on Timesheet.
  await bobPage.getByRole("link", { name: "Timesheet", exact: true }).click();
  await expect(bobPage.getByTestId("timesheet-team-overview")).not.toBeVisible();

  // Carol (Finance Manager) does see the team overview.
  await carolPage.getByRole("link", { name: "Open" }).click();
  await carolPage.getByRole("link", { name: "Timesheet", exact: true }).click();
  await expect(carolPage.getByTestId("timesheet-team-overview")).toBeVisible();

  await bobContext.close();
  await carolContext.close();
});
