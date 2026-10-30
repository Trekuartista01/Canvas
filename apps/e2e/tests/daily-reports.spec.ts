import { expect, test } from "@playwright/test";
import { createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

const PASSWORD = "initial-pass-123";

test("M7.3 daily reports: staff submits, a manager opens it, the read receipt shows up", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  // The owner (super admin) adds a staff member.
  await signUp(page, "Mira Manager");
  await createWorkspaceAndOpen(page, "Reports Workspace");
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

  // Before Sam reports, the team view lists him as missing.
  await page.getByRole("link", { name: "Team reports" }).click();
  const samRow = page.getByTestId("team-report-Sam Staff");
  await expect(samRow).toContainText("Not submitted");

  // Sam writes and submits today's report.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, staffEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await expect(staff.getByTestId("my-tasks-page")).toBeVisible();
  // Staff see their own daily report, not the team view.
  await expect(staff.getByRole("link", { name: "Team reports" })).toHaveCount(0);
  await staff.getByRole("link", { name: "Daily report" }).click();
  await expect(staff.getByTestId("daily-report-status")).toHaveText("Not submitted yet");

  const editor = staff.getByLabel("Daily report", { exact: true });
  await editor.click();
  await staff.keyboard.type("Visited three stores and restocked the shelf displays.");
  const saved = staff.waitForResponse((res) => res.url().includes("dailyReport.save"));
  await staff.getByTestId("daily-report-submit").click();
  expect((await saved).ok()).toBe(true);
  await expect(staff.getByTestId("daily-report-status")).toContainText("Submitted at");

  // Still editable today.
  await expect(staff.getByTestId("daily-report-submit")).toHaveText("Save changes");

  // The manager sees it come in (realtime) and opens it — that's the read.
  await expect(samRow).toContainText("Submitted");
  await expect(samRow).toContainText("Unread");
  const read = page.waitForResponse((res) => res.url().includes("dailyReport.markRead"));
  await samRow.getByRole("link").click();
  await read;
  const view = page.getByTestId("daily-report-view");
  await expect(view).toContainText("Visited three stores and restocked the shelf displays.");
  await expect(view.getByRole("heading", { level: 1 })).toContainText("Sam Staff");

  // Back in the team view it's marked read.
  await page.getByRole("link", { name: "← Team reports" }).click();
  await expect(page.getByTestId("team-report-Sam Staff")).toContainText("Read by 1");

  // Sam opens his own report and sees who read it.
  await staff.getByRole("link", { name: "View · read receipts" }).click();
  await expect(staff.getByTestId("daily-report-readers")).toContainText("Mira Manager");

  await staffContext.close();
});
