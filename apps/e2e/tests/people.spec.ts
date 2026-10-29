import { expect, test, type Page } from "@playwright/test";
import { createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

const PASSWORD = "initial-pass-123";

async function addStaff(
  page: Page,
  person: { name: string; email: string; role: string; jobTitle?: string },
) {
  await page.getByTestId("people-add-staff").click();
  const form = page.getByTestId("add-staff-form");
  await form.getByLabel("Full name").fill(person.name);
  await form.getByLabel("Email").fill(person.email);
  await form.getByLabel("Initial password").fill(PASSWORD);
  await form.getByLabel("Role").selectOption(person.role);
  if (person.jobTitle) await form.getByLabel("Position / job title").fill(person.jobTitle);
  const created = page.waitForResponse((res) => res.url().includes("people.createStaff"));
  await page.getByTestId("add-staff-submit").click();
  expect((await created).ok()).toBe(true);
  await expect(page.getByTestId(`person-row-${person.email}`)).toBeVisible();
}

test("M7.1 People: HR creates staff, sets their manager, staff logs in and lands on My Tasks", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  // The owner is always super admin — they add the HR person.
  await signUp(page, "Olive Owner");
  await createWorkspaceAndOpen(page, "People Workspace");
  await page.getByRole("link", { name: "Directory" }).click();
  await expect(page.getByTestId("people-page")).toBeVisible();
  const hrEmail = uniqueEmail("hr");
  await addStaff(page, { name: "Hana HR", email: hrEmail, role: "hr" });

  // HR signs in with the initial password and builds the team.
  const hrContext = await browser.newContext();
  const hr = await hrContext.newPage();
  await logIn(hr, hrEmail, PASSWORD);
  await hr.getByRole("link", { name: "Open" }).click();
  // HR is a manager-side role: lands on the team view, not My Tasks.
  await expect(hr.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await hr.getByRole("link", { name: "Directory" }).click();

  const managerEmail = uniqueEmail("manager");
  const staffEmail = uniqueEmail("staff");
  await addStaff(hr, { name: "Milo Manager", email: managerEmail, role: "staff_manager" });
  await addStaff(hr, {
    name: "Sam Staff",
    email: staffEmail,
    role: "staff",
    jobTitle: "Sales associate",
  });

  // Set Sam's manager from his profile.
  await hr.getByTestId(`person-row-${staffEmail}`).click();
  const profile = hr.getByTestId("person-profile");
  await expect(profile.getByRole("heading", { name: "Sam Staff" })).toBeVisible();
  await expect(profile.getByTestId("person-details")).toContainText("Sales associate");
  const managerSet = hr.waitForResponse((res) => res.url().includes("people.setManager"));
  await hr.locator("#person-manager").selectOption({ label: "Milo Manager" });
  await managerSet;
  await expect(profile.getByTestId("person-details")).toContainText("Milo Manager");

  // Sam signs in: lands on My Tasks, and sees no manager-only sections.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, staffEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await expect(staff.getByTestId("my-tasks-page")).toBeVisible();
  await expect(staff).toHaveURL(/\/my-tasks$/);
  await expect(staff.getByRole("link", { name: "My Tasks" })).toBeVisible();
  await expect(staff.getByRole("link", { name: "Directory" })).toHaveCount(0);
  await expect(staff.getByRole("link", { name: "Home", exact: true })).toHaveCount(0);

  // HR deactivates Sam: the workspace disappears for him, history stays.
  const statusSet = hr.waitForResponse((res) => res.url().includes("people.setStatus"));
  await hr.getByTestId("person-status-toggle").click();
  await statusSet;
  await expect(profile).toContainText("Deactivated");
  await staff.goto("/");
  await expect(staff.getByText(staffEmail)).toBeVisible();
  await expect(staff.getByRole("link", { name: "Open" })).toHaveCount(0);

  await hrContext.close();
  await staffContext.close();
});
