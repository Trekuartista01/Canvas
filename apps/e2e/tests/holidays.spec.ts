import { expect, test, type Page } from "@playwright/test";
import { createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

const PASSWORD = "initial-pass-123";

// Pins the page to 2027, whatever today's date is.
async function goToYear(page: Page, target: number) {
  const year = page.getByTestId("holidays-year");
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

test("M7.4 holidays: seeded Kosovo calendar, HR adds a movable holiday, weekend days move, staff can read it", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  await signUp(page, "Hana HR");
  await createWorkspaceAndOpen(page, "Holiday Workspace");
  await page.getByRole("link", { name: "Holidays" }).click();
  await expect(page.getByTestId("holidays-page")).toBeVisible();
  await goToYear(page, 2027);

  // The fixed-date holidays were seeded with the workspace.
  const list = page.getByTestId("holidays-list");
  await expect(list).toContainText("Independence Day");
  await expect(list).toContainText("Orthodox Christmas");
  // 1 May 2027 is a Saturday → Monday 3 May off.
  const labourDay = page.getByTestId("holiday-Labour Day");
  await expect(labourDay).toContainText(/Day off Mon,? 3 May|Day off Mon, May 3/);

  // Nothing movable for 2027 yet.
  await expect(page.getByTestId("holidays-missing-movable")).toContainText(
    "No movable holidays entered for 2027",
  );

  // HR adds Orthodox Easter Monday — the date comes prefilled (3 May 2027).
  await page.getByRole("button", { name: "+ Orthodox Easter Monday" }).click();
  const form = page.getByTestId("holiday-form");
  await expect(form.getByLabel("Date", { exact: true })).toHaveValue("2027-05-03");
  const created = page.waitForResponse((res) => res.url().includes("holiday.create"));
  await form.getByTestId("holiday-save").click();
  expect((await created).ok()).toBe(true);

  await expect(page.getByTestId("holiday-Orthodox Easter Monday")).toContainText("2027 only");
  await expect(page.getByTestId("holidays-missing-movable")).toHaveCount(0);
  // Monday is now taken, so Labour Day's day off moves on to Tuesday.
  await expect(labourDay).toContainText(/Day off Tue,? 4 May|Day off Tue, May 4/);

  // A staff member sees the same calendar, read-only.
  await page.getByRole("link", { name: "Directory" }).click();
  const staffEmail = uniqueEmail("staff");
  await page.getByTestId("people-add-staff").click();
  const staffForm = page.getByTestId("add-staff-form");
  await staffForm.getByLabel("Full name").fill("Sam Staff");
  await staffForm.getByLabel("Email").fill(staffEmail);
  await staffForm.getByLabel("Initial password").fill(PASSWORD);
  await staffForm.getByLabel("Role").selectOption("staff");
  const staffCreated = page.waitForResponse((res) => res.url().includes("people.createStaff"));
  await page.getByTestId("add-staff-submit").click();
  expect((await staffCreated).ok()).toBe(true);

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, staffEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await staff.getByRole("link", { name: "Holidays" }).click();
  await goToYear(staff, 2027);
  await expect(staff.getByTestId("holiday-Orthodox Easter Monday")).toBeVisible();
  await expect(staff.getByTestId("holiday-add")).toHaveCount(0);

  await staffContext.close();
});
