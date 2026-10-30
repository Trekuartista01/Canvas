import { expect, test, type Page } from "@playwright/test";
import { createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

const PASSWORD = "initial-pass-123";

async function goToYear(page: Page, target: number) {
  const year = page.getByTestId("leave-year");
  await expect(year).toHaveText(/\d{4}/);
  let current = Number(await year.textContent());
  while (current !== target) {
    await page
      .getByRole("button", { name: current < target ? "Next year" : "Previous year" })
      .click();
    current += current < target ? 1 : -1;
    await expect(year).toHaveText(String(current));
  }
}

const stat = (page: Page, label: string) =>
  page.getByTestId("leave-balance").locator("div", { hasText: label }).locator("p").nth(1);

test("M7.5 leave: staff requests vacation → manager approves → balance decreases, PDF downloads", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  await signUp(page, "Mira Manager");
  await createWorkspaceAndOpen(page, "Leave Workspace");
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

  // Sam asks for Mon 1 – Fri 5 March 2027 (no holidays that week).
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, staffEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await staff.getByRole("link", { name: "Leave", exact: true }).click();
  await expect(staff.getByTestId("leave-page")).toBeVisible();
  // Staff don't approve leave.
  await expect(staff.getByRole("link", { name: "Leave approvals" })).toHaveCount(0);
  await goToYear(staff, 2027);
  await expect(staff.getByTestId("leave-remaining")).toHaveText("20");

  const leaveForm = staff.getByTestId("leave-form");
  await leaveForm.getByLabel("Type").selectOption("vacation");
  // A weekend-only range has no working days.
  await leaveForm.getByLabel("First day").fill("2027-03-06");
  await leaveForm.getByLabel("Last day").fill("2027-03-07");
  await expect(leaveForm.getByRole("alert")).toContainText("no working days");

  await leaveForm.getByLabel("First day").fill("2027-03-01");
  await leaveForm.getByLabel("Last day").fill("2027-03-05");
  await expect(staff.getByTestId("leave-preview")).toContainText("5 working days");
  const requested = staff.waitForResponse((res) => res.url().includes("leave.request"));
  await staff.getByTestId("leave-submit").click();
  expect((await requested).ok()).toBe(true);

  const request = staff.getByTestId("leave-request-2027-03-01");
  await expect(request).toContainText("Pending");
  await expect(stat(staff, "Pending")).toHaveText("5");
  await expect(staff.getByTestId("leave-remaining")).toHaveText("15");

  // Overlapping the same week again is refused.
  await leaveForm.getByLabel("First day").fill("2027-03-04");
  await leaveForm.getByLabel("Last day").fill("2027-03-08");
  await expect(leaveForm.getByRole("alert")).toContainText("Overlaps vacation");

  // The manager approves it.
  await page.getByRole("link", { name: "Leave approvals" }).click();
  const row = page.getByTestId("leave-approval-Sam Staff");
  await expect(row).toContainText("5 days");
  await expect(row).toContainText("20 of 20 vacation days left in 2027");
  const decided = page.waitForResponse((res) => res.url().includes("leave.decide"));
  await row.getByTestId("leave-approve").click();
  expect((await decided).ok()).toBe(true);
  await expect(page.getByTestId("leave-approvals-empty")).toBeVisible();

  // Sam's balance: 5 used, 15 left, and a confirmation PDF.
  await expect(request).toContainText("Approved");
  await expect(stat(staff, "Used")).toHaveText("5");
  await expect(stat(staff, "Pending")).toHaveText("0");
  await expect(staff.getByTestId("leave-remaining")).toHaveText("15");

  const pdfHref = await request.getByTestId("leave-pdf").getAttribute("href");
  const pdf = await staff.request.get(pdfHref!);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Who's off shows Sam that week.
  await staff.getByRole("link", { name: "Who's off" }).click();
  const month = staff.getByTestId("whos-off-month");
  for (let i = 0; i < 36 && !(await month.textContent())?.includes("2027"); i++) {
    await staff.getByRole("button", { name: "Next month" }).click();
  }
  while (!(await month.textContent())?.match(/March|Mar/)) {
    await staff.getByRole("button", { name: "Next month" }).click();
  }
  await expect(staff.getByTestId("whos-off-2027-03-03")).toContainText("Sam Staff");

  await staffContext.close();
});
