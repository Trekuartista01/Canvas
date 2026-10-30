import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

const IMAGE_FIXTURE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));
const PASSWORD = "initial-pass-123";

test("M7.2 approval: manager assigns with proof required → staff submits with a photo → manager approves → completed", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  // The owner (super admin) adds a staff member and creates a list.
  await signUp(page, "Mira Manager");
  await createWorkspaceAndOpen(page, "Approval Workspace");
  await page.getByRole("link", { name: "Directory" }).click();
  const staffEmail = uniqueEmail("staff");
  await page.getByTestId("people-add-staff").click();
  const form = page.getByTestId("add-staff-form");
  await form.getByLabel("Full name").fill("Sam Staff");
  await form.getByLabel("Email").fill(staffEmail);
  await form.getByLabel("Initial password").fill(PASSWORD);
  await form.getByLabel("Role").selectOption("staff");
  const created = page.waitForResponse((res) => res.url().includes("people.createStaff"));
  await page.getByTestId("add-staff-submit").click();
  expect((await created).ok()).toBe(true);

  await createSpaceAndList(page, "Operations", "Store visits");

  // New lists come with the approval lifecycle.
  await page.getByRole("button", { name: "Board", exact: true }).click();
  for (const column of ["Pending", "In progress", "Awaiting approval", "Completed"]) {
    await expect(page.getByTestId(`status-column-${column}`)).toBeVisible();
  }

  // Create dialog: assignee, priority, due date + time, proof required.
  await page.getByTestId("new-task-button").click();
  const dialog = page.getByTestId("new-task-dialog");
  await dialog.getByLabel("Title").fill("Photograph the shelf display");
  await dialog.getByLabel("Assign Sam Staff").check();
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByLabel("Due date").fill("2030-05-14");
  await dialog.getByLabel("Due time").fill("14:30");
  await dialog.getByLabel(/Requires a proof photo/).check();
  const taskCreated = page.waitForResponse((res) => res.url().includes("task.create"));
  await dialog.getByTestId("new-task-submit").click();
  expect((await taskCreated).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByTestId("status-column-Pending").getByText("Photograph the shelf display"),
  ).toBeVisible();

  // Staff signs in, finds it on My Tasks with its due time.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, staffEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await expect(staff.getByTestId("my-tasks-page")).toBeVisible();
  // A fresh login with a high-priority task opens the login summary first.
  const summary = staff.getByTestId("login-summary-panel");
  await expect(summary).toBeVisible();
  await summary.getByRole("button", { name: "Close", exact: true }).click();
  const myTask = staff
    .getByTestId("my-tasks-list")
    .getByRole("link", { name: /Photograph the shelf display/ });
  await expect(myTask).toContainText("14:30");
  await myTask.click();

  const approval = staff.getByTestId("task-approval");
  await expect(approval).toContainText("Proof required");
  // No proof yet → can't submit.
  await expect(approval.getByTestId("submit-for-review")).toBeDisabled();

  const proofUploaded = staff.waitForResponse((res) =>
    res.url().includes("attachment.confirmUpload"),
  );
  await approval.getByTestId("proof-file-input").setInputFiles(IMAGE_FIXTURE);
  expect((await proofUploaded).ok()).toBe(true);
  await expect(approval.getByRole("button", { name: /Open test-image\.png/ })).toBeVisible();

  const submitted = staff.waitForResponse((res) => res.url().includes("task.submitForReview"));
  await approval.getByTestId("submit-for-review").click();
  expect((await submitted).ok()).toBe(true);
  await expect(approval).toContainText("Waiting for a manager to approve it.");
  // Staff can't approve their own work.
  await expect(approval.getByTestId("approve-task")).toHaveCount(0);

  // The manager is notified and approves from the task panel.
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const reviewColumn = page.getByTestId("status-column-Awaiting approval");
  await reviewColumn.getByRole("button", { name: "Photograph the shelf display" }).click();
  const managerApproval = page.getByTestId("task-approval");
  await expect(managerApproval.getByRole("button", { name: /Open test-image\.png/ })).toBeVisible();
  const approved = page.waitForResponse((res) => res.url().includes("task.approve"));
  await managerApproval.getByTestId("approve-task").click();
  expect((await approved).ok()).toBe(true);
  await expect(managerApproval).toContainText("Approved");
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("status-column-Completed").getByText("Photograph the shelf display"),
  ).toBeVisible();

  // Back on My Tasks, the staff member sees it done.
  await staff.goto(staff.url().replace(/\/l\/.*$/, "/my-tasks"));
  await expect(staff.getByTestId("my-tasks-list")).toContainText("Done");

  await staffContext.close();
});
