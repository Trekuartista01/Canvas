import { expect, test, type Page } from "@playwright/test";
import {
  createWorkspaceAndOpen,
  openAsHr,
  pageAs,
  seedMember,
  signUp,
  workspaceIdFrom,
} from "./helpers";

// Pins a holiday calendar to `target`, whatever today's date is.
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

test("P8.2 official holidays: seeded 2027 calendar, HR keeps it in Leave approvals, the calculator uses it", async ({
  page: ownerPage,
  browser,
}) => {
  test.setTimeout(120_000);

  await signUp(ownerPage, "Olsi Owner");
  await createWorkspaceAndOpen(ownerPage, "Holiday Workspace");
  const workspaceId = workspaceIdFrom(ownerPage);
  const { hrPage: hr } = await openAsHr(browser, workspaceId);

  // Everyone's Holidays page is read-only; HR gets a link to the editor.
  await hr.getByRole("link", { name: "Holidays" }).click();
  await expect(hr.getByTestId("holidays-page")).toBeVisible();
  await expect(hr.getByTestId("holiday-add")).toHaveCount(0);
  await hr.getByTestId("holidays-edit-link").click();
  await expect(hr.getByRole("tab", { name: "Festat zyrtare / Official holidays" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await goToYear(hr, 2027);

  // Seeded with the workspace: fixed dates, Easter Mondays, Eids to confirm,
  // and Mon 4 Jan as the substitute for Sat 2 Jan (substitution is on).
  const list = hr.getByTestId("holidays-list");
  await expect(list).toContainText("Dita e Pavarësisë");
  await expect(hr.getByTestId("holiday-2027-05-03")).toContainText("Orthodox Easter Monday");
  await expect(hr.getByTestId("holiday-2027-01-04")).toContainText("Substitute");
  await expect(hr.getByTestId("holiday-2027-03-10")).toContainText("Confirm date");

  // Switching substitution off removes the future substitutes; on brings them back.
  const substitution = hr.getByTestId("holiday-substitution");
  await expect(substitution).toBeChecked();
  const toggle = async () => {
    const saved = hr.waitForResponse((res) => res.url().includes("holiday.setWeekendSubstitution"));
    await substitution.click();
    expect((await saved).ok()).toBe(true);
  };
  await toggle();
  await expect(substitution).not.toBeChecked();
  await expect(hr.getByTestId("holiday-2027-01-04")).toHaveCount(0);
  await toggle();
  await expect(substitution).toBeChecked();
  await expect(hr.getByTestId("holiday-2027-01-04")).toContainText("Substitute");

  // HR confirms the government's Eid date (one day earlier than estimated).
  const eid = hr.getByTestId("holiday-2027-03-10");
  await eid.hover();
  await eid.getByRole("button", { name: "Edit" }).click();
  const form = hr.getByTestId("holiday-form");
  await form.getByLabel("Emri (shqip)").fill("Fitër Bajrami");
  await form.getByLabel("Name (English)").fill("Eid al-Fitr");
  await form.getByLabel("Date").fill("2027-03-09");
  const updated = hr.waitForResponse((res) => res.url().includes("holiday.update"));
  await form.getByTestId("holiday-save").click();
  expect((await updated).ok()).toBe(true);
  await expect(hr.getByTestId("holiday-2027-03-09")).toContainText("Eid al-Fitr");
  await expect(hr.getByTestId("holiday-2027-03-09")).not.toContainText("Confirm date");

  // An employee reads the same calendar, without edit controls or the link,
  // and the leave form counts with it: 30 Dec 2026 – 5 Jan 2027 is 3 days.
  const employee = await seedMember(workspaceId, "Sam Staff", "employee");
  const staff = await pageAs(browser, employee, workspaceId);
  await staff.getByRole("link", { name: "Holidays" }).click();
  await goToYear(staff, 2027);
  await expect(staff.getByTestId("holiday-2027-03-09")).toBeVisible();
  await expect(staff.getByTestId("holidays-edit-link")).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Edit" })).toHaveCount(0);

  await staff.getByRole("link", { name: "Leave", exact: true }).click();
  const leaveForm = staff.getByTestId("leave-form");
  await leaveForm.getByLabel("Type").selectOption("vacation");
  await leaveForm.getByLabel("First day").fill("2026-12-30");
  await leaveForm.getByLabel("Last day").fill("2027-01-05");
  await expect(staff.getByTestId("leave-preview")).toContainText("3 working days");
  await expect(staff.getByTestId("leave-preview-holidays")).toContainText("New Year's Day");
  await expect(staff.getByTestId("leave-preview-return")).toContainText(/Wed,? (6 Jan|Jan 6)/);

  // The owner (admin) reads, never manages.
  await ownerPage.getByRole("link", { name: "Holidays" }).click();
  await goToYear(ownerPage, 2027);
  await expect(ownerPage.getByTestId("holiday-2027-03-09")).toBeVisible();
  await expect(ownerPage.getByTestId("holidays-edit-link")).toHaveCount(0);

  await staff.context().close();
  await hr.context().close();
});
