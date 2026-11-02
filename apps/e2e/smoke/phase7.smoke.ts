import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  createSpaceAndList,
  createWorkspaceAndOpen,
  inviteAndGetLink,
  logIn,
  signUp,
} from "../tests/helpers";

const IMAGE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));
const PASSWORD = "smoke-test-pass-123";
const stamp = Date.now();
const smokeEmail = (who: string) => `smoke-${who}-${stamp}@example.com`;

/** The first Monday–Friday week of March next year: no Kosovo holidays in it. */
function nextYearsQuietWeek() {
  const year = new Date().getUTCFullYear() + 1;
  const first = new Date(Date.UTC(year, 2, 1));
  const monday = new Date(first);
  monday.setUTCDate(1 + ((8 - first.getUTCDay()) % 7));
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { year, from: iso(monday), to: iso(friday) };
}

/** The post-login summary opens over the page when someone has assigned work. */
async function closeLoginSummary(page: Page) {
  const summary = page.getByTestId("login-summary-panel");
  if (await summary.isVisible({ timeout: 3000 }).catch(() => false)) {
    await summary.getByRole("button", { name: "Close", exact: true }).click();
  }
}

async function addStaff(page: Page, name: string, email: string) {
  await page.getByRole("link", { name: "Directory" }).click();
  await page.getByTestId("people-add-staff").click();
  const form = page.getByTestId("add-staff-form");
  await form.getByLabel("Full name").fill(name);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Initial password").fill(PASSWORD);
  await form.getByLabel("Role").selectOption("staff");
  const created = page.waitForResponse((res) => res.url().includes("people.createStaff"));
  await page.getByTestId("add-staff-submit").click();
  expect((await created).ok()).toBe(true);
}

test("Phase-7 smoke: health → sign up → workspace → invite → daily report → proof approval → leave → HR-only payroll export", async ({
  page,
  browser,
}) => {
  // 1. Health: API, database, Redis and storage all green.
  const health = await page.request.get("/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({
    ok: true,
    checks: { api: "ok", database: "ok", redis: "ok", storage: "ok" },
  });

  // 2. Sign up → workspace → invite.
  await signUp(page, "Smoke Owner", smokeEmail("owner"));
  await createWorkspaceAndOpen(page, `Smoke test ${stamp}`);
  const workspaceId = page.url().match(/\/w\/([^/]+)/)![1]!;
  // Invites are sent from the workspace list.
  await page.getByRole("link", { name: "All workspaces" }).click();
  const invite = await inviteAndGetLink(page, smokeEmail("invitee"));
  expect(invite).toContain("/invite/");
  await page.goto(`/w/${workspaceId}`);

  // A staff member (HR creates accounts directly) and a task needing a proof photo.
  const staffEmail = smokeEmail("staff");
  await addStaff(page, "Smoke Staff", staffEmail);
  await createSpaceAndList(page, "Smoke", "Smoke list");
  await page.getByTestId("new-task-button").click();
  const dialog = page.getByTestId("new-task-dialog");
  await dialog.getByLabel("Title").fill("Smoke: photograph the display");
  await dialog.getByLabel("Assign Smoke Staff").check();
  await dialog.getByLabel(/Requires a proof photo/).check();
  const taskCreated = page.waitForResponse((res) => res.url().includes("task.create"));
  await dialog.getByTestId("new-task-submit").click();
  expect((await taskCreated).ok()).toBe(true);

  // 3. Staff: daily report, then the proof photo (straight to R2) and submit.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, staffEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await expect(staff.getByTestId("my-tasks-page")).toBeVisible();
  await closeLoginSummary(staff);
  await staff.getByRole("link", { name: "Daily report" }).click();
  await staff.getByLabel("Daily report", { exact: true }).click();
  await staff.keyboard.type("Smoke test daily report.");
  await staff.getByTestId("daily-report-submit").click();
  await expect(staff.getByTestId("daily-report-status")).toContainText("Submitted at");

  await staff.getByRole("link", { name: "My Tasks" }).click();
  await staff
    .getByTestId("my-tasks-list")
    .getByRole("link", { name: /Smoke: photograph the display/ })
    .click();
  const approval = staff.getByTestId("task-approval");
  const uploaded = staff.waitForResponse((res) => res.url().includes("attachment.confirmUpload"));
  await approval.getByTestId("proof-file-input").setInputFiles(IMAGE);
  expect((await uploaded).ok()).toBe(true);
  await approval.getByTestId("submit-for-review").click();
  await expect(approval).toContainText("Waiting for a manager to approve it.");
  await staff.getByRole("button", { name: "Close task details" }).click();

  // 4. Owner approves the task.
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page
    .getByTestId("status-column-Awaiting approval")
    .getByRole("button", { name: "Smoke: photograph the display" })
    .click();
  const approved = page.waitForResponse((res) => res.url().includes("task.approve"));
  await page.getByTestId("task-approval").getByTestId("approve-task").click();
  expect((await approved).ok()).toBe(true);
  await page.getByRole("button", { name: "Close task details" }).click();

  // 5. Staff requests a week of vacation next year; the owner approves.
  const week = nextYearsQuietWeek();
  await staff.getByRole("link", { name: "Leave", exact: true }).click();
  const leave = staff.getByTestId("leave-form");
  await leave.getByLabel("Type").selectOption("vacation");
  await leave.getByLabel("First day").fill(week.from);
  await leave.getByLabel("Last day").fill(week.to);
  await expect(staff.getByTestId("leave-preview")).toContainText("5 working days");
  await staff.getByTestId("leave-submit").click();
  await expect(staff.getByTestId(`leave-request-${week.from}`)).toContainText("Pending");

  await page.getByRole("link", { name: "Leave approvals" }).click();
  const decided = page.waitForResponse((res) => res.url().includes("leave.decide"));
  await page.getByTestId("leave-approval-Smoke Staff").getByTestId("leave-approve").click();
  expect((await decided).ok()).toBe(true);
  await expect(staff.getByTestId(`leave-request-${week.from}`)).toContainText("Approved");

  // 6. Payroll: HR saves a record (encrypted) and exports; staff are refused.
  await page.getByRole("link", { name: "Payroll" }).click();
  await page.getByTestId("payroll-row-Smoke Staff").click();
  const drawer = page.getByTestId("payroll-drawer");
  await drawer.getByLabel("Net salary (EUR / month)").fill("500");
  await drawer.getByLabel("IBAN").fill("XK051212012345678906");
  const saved = page.waitForResponse((res) => res.url().includes("payroll.upsert"));
  await drawer.getByTestId("payroll-save").click();
  expect((await saved).ok()).toBe(true);
  const xlsx = await page.request.get(`/payroll-export/${workspaceId}/payroll.xlsx`);
  expect(xlsx.ok()).toBe(true);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  expect((await staff.request.get(`/payroll-export/${workspaceId}/payroll.xlsx`)).status()).toBe(
    403,
  );

  await staffContext.close();
});
