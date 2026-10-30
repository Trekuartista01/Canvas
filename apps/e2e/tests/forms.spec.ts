import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  inviteAndGetLink,
  setPeopleRole,
  signUp,
} from "./helpers";

const DOC_FIXTURE = fileURLToPath(new URL("../fixtures/test-doc.txt", import.meta.url));

test("M4.5 forms: build an intake form, submit it anonymously, and see the task land in the list", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Form Builder");
  await createWorkspaceAndOpen(page, "Intake Workspace");
  await createSpaceAndList(page, "Support", "Bug Reports");

  await page.getByRole("link", { name: "Forms", exact: true }).click();
  await expect(page.getByTestId("forms-list-page")).toBeVisible();

  await page.getByTestId("forms-new").click();
  await page.getByTestId("forms-new-name").fill("Bug report intake");
  await page.getByTestId("forms-new-list").selectOption({ label: "Support / Bug Reports" });
  await page.getByTestId("form-field-title-label").fill("What's broken?");

  await page.getByTestId("form-add-field").click();
  await page.getByTestId("form-field-label").fill("Severity");
  await page.locator("select").last().selectOption("select");
  await page.getByTestId("form-field-options").fill("Low, High");

  const formCreated = page.waitForResponse((res) => res.url().includes("form.create"));
  await page.getByTestId("forms-create-submit").click();
  await formCreated;

  const formLink = page.getByTestId(/^forms-link-/);
  await expect(formLink).toBeVisible();
  await formLink.click();
  await expect(page.getByTestId("form-editor-page")).toBeVisible();

  const publicUrl = await page.getByTestId("form-public-link").inputValue();
  expect(publicUrl).toContain("/forms/");

  // Submit the form as an anonymous visitor in a fresh browser context —
  // no sign-up, no session.
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(publicUrl);
  await expect(publicPage.getByTestId("public-form-page")).toBeVisible();

  await publicPage.getByTestId("public-form-field-title").fill("Login button does nothing");
  await publicPage.getByTestId(/^public-form-field-field-/).selectOption("High");
  const submitted = publicPage.waitForResponse((res) => res.url().includes("submitPublic"));
  await publicPage.getByTestId("public-form-submit").click();
  await submitted;
  await expect(publicPage.getByText("Thanks — your submission was received.")).toBeVisible();
  await publicContext.close();

  // Back as the workspace member: the anonymous submission became a real
  // task in the target list.
  await page.getByRole("link", { name: "All workspaces" }).click();
  await page.getByRole("link", { name: "Open" }).click();
  await page.getByRole("link", { name: "Bug Reports" }).click();
  await expect(page.getByRole("heading", { name: "# Bug Reports" })).toBeVisible();

  // Board view's card is a single button that opens the detail panel; list
  // view's title cell is an inline-rename button instead (see
  // task-list-view.tsx), so switch views to open the task the same way
  // task-templates.spec.ts does.
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const taskCard = page.getByRole("button", { name: "Login button does nothing" });
  await expect(taskCard).toBeVisible({ timeout: 15_000 });
  await taskCard.click();

  const panel = page.getByTestId("task-detail-panel");
  await expect(panel.getByText("Severity: High")).toBeVisible();
});

test("task-completion forms: bind a form to a task, an anonymous submitter attaches a file and finishes it, ops manager gets notified", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Nia Owner");
  await createWorkspaceAndOpen(page, "Delivery Workspace");

  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-forms-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, bobEmail);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Forms", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByRole("link", { name: "Open" })).toBeVisible();
  await bobPage.getByRole("link", { name: "Open" }).click();
  await expect(bobPage.getByLabel("Notifications")).toBeVisible();

  await page.getByRole("link", { name: "Open" }).click();
  await setPeopleRole(page, bobEmail, "operation_manager");

  await createSpaceAndList(page, "Delivery", "Assets");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Design homepage banner");
  await page.keyboard.press("Enter");

  await page.getByRole("link", { name: "Forms", exact: true }).click();
  await page.getByTestId("forms-new").click();
  await page.getByTestId("forms-new-name").fill("Banner delivery");
  await page.getByTestId("forms-new-list").selectOption({ label: "Delivery / Assets" });
  await page.getByTestId("form-field-title-label").fill("What did you make?");
  const formCreated = page.waitForResponse((res) => res.url().includes("form.create"));
  await page.getByTestId("forms-create-submit").click();
  await formCreated;

  const formLink = page.getByTestId(/^forms-link-/);
  await expect(formLink).toBeVisible();
  await formLink.click();
  await expect(page.getByTestId("form-editor-page")).toBeVisible();

  // Bind the form to the task instead of leaving it as a fields-based
  // intake form.
  await page.getByTestId("form-bind-task-search").fill("Design homepage");
  const bindResult = page.getByTestId(/^form-bind-task-result-/);
  await expect(bindResult).toBeVisible();
  const bound = page.waitForResponse((res) => res.url().includes("form.update"));
  await bindResult.click();
  await bound;
  await expect(page.getByTestId("form-bound-task-title")).toHaveText("Design homepage banner");
  await expect(
    page.getByText("Anyone with this link can attach files and mark the linked task done"),
  ).toBeVisible();
  // Fields editor is hidden once bound — nothing left to configure.
  await expect(page.getByTestId("form-field-title-label")).toHaveCount(0);

  const publicUrl = await page.getByTestId("form-public-link").inputValue();

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(publicUrl);
  await expect(publicPage.getByTestId("public-form-page")).toBeVisible();
  await expect(publicPage.getByText("Design homepage banner")).toBeVisible();
  await expect(publicPage.getByText(/Only submit once you've actually finished/)).toBeVisible();

  await publicPage.getByTestId("public-form-submitter-name").fill("External Contractor");
  await publicPage.getByTestId("public-attach-file-input").setInputFiles(DOC_FIXTURE);
  await expect(publicPage.getByTestId("public-attach-chips")).toBeVisible();
  await expect(publicPage.getByText("test-doc.txt")).toBeVisible();

  const submittedTask = publicPage.waitForResponse((res) => res.url().includes("submitPublic"));
  await publicPage.getByTestId("public-form-submit").click();
  await submittedTask;
  await expect(publicPage.getByText("Thanks, External Contractor — marked as done.")).toBeVisible();
  await publicContext.close();

  // Back as the workspace owner: the task moved to Done on the board.
  await page.getByRole("link", { name: "All workspaces" }).click();
  await page.getByRole("link", { name: "Open" }).click();
  await page.getByRole("link", { name: "Assets" }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page.getByTestId("status-column-Completed").getByText("Design homepage banner"),
  ).toBeVisible({ timeout: 15_000 });

  // Bob, the Operations Manager, was notified with the external
  // submitter's own name — not the form owner's.
  await bobPage.reload();
  await expect(bobPage.getByLabel("Notifications")).toContainText("1");
  await bobPage.getByLabel("Notifications").click();
  const notification = bobPage.getByText(
    /External Contractor\s*finished\s*.Design homepage banner./,
  );
  await expect(notification).toBeVisible();
  await notification.click();
  await expect(bobPage.getByLabel("Task title")).toHaveValue("Design homepage banner");
  await bobContext.close();
});
