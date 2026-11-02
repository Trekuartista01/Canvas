import { expect, test, type Page } from "@playwright/test";
import {
  createWorkspaceAndOpen,
  logIn,
  openAsHr,
  pageAs,
  seedMember,
  signUp,
  uniqueEmail,
  workspaceIdFrom,
} from "./helpers";

const PASSWORD = "initial-pass-123";

async function addStaff(
  page: Page,
  person: { name: string; email: string; jobTitle?: string; phone?: string },
) {
  await page.getByTestId("people-add-staff").click();
  const form = page.getByTestId("add-staff-form");
  await form.getByLabel("Full name").fill(person.name);
  await form.getByLabel("Email").fill(person.email);
  await form.getByLabel("Initial password").fill(PASSWORD);
  if (person.jobTitle) await form.getByLabel("Position / job title").fill(person.jobTitle);
  if (person.phone) await form.getByLabel("Phone", { exact: true }).fill(person.phone);
  const created = page.waitForResponse((res) => res.url().includes("people.createStaff"));
  await page.getByTestId("add-staff-submit").click();
  expect((await created).ok()).toBe(true);
  await expect(page.getByTestId(`person-row-${person.email}`)).toBeVisible();
}

test("People (P8.1): HR adds employees, admin assigns roles and HR hears about it, confidential fields stay with HR", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(120_000);

  await signUp(owner, "Olive Owner");
  await createWorkspaceAndOpen(owner, "People Workspace");
  const workspaceId = workspaceIdFrom(owner);

  // HR builds the team. Only employees can be added — roles are admin's.
  const { hrPage: hr } = await openAsHr(browser, workspaceId);
  await hr.getByRole("link", { name: "Directory" }).click();
  await expect(hr.getByTestId("people-page")).toBeVisible();
  const miloEmail = uniqueEmail("milo");
  const staffEmail = uniqueEmail("staff");
  await addStaff(hr, { name: "Milo Manager", email: miloEmail });
  await addStaff(hr, {
    name: "Sam Staff",
    email: staffEmail,
    jobTitle: "Sales associate",
    phone: "+383 44 123 456",
  });
  await expect(hr.getByTestId("add-staff-form").getByLabel("Role")).toHaveCount(0);

  // HR sets Sam's manager and sees his confidential details.
  await hr.getByTestId(`person-row-${staffEmail}`).click();
  const profile = hr.getByTestId("person-profile");
  await expect(profile.getByRole("heading", { name: "Sam Staff" })).toBeVisible();
  await expect(profile.getByTestId("person-details")).toContainText("Sales associate");
  await expect(profile.getByTestId("person-details")).toContainText("+383 44 123 456");
  // HR doesn't assign roles.
  await expect(hr.locator("#person-role")).toHaveCount(0);
  const managerSet = hr.waitForResponse((res) => res.url().includes("people.setManager"));
  await hr.locator("#person-manager").selectOption({ label: "Milo Manager" });
  await managerSet;
  await expect(profile.getByTestId("person-details")).toContainText("Milo Manager");

  // The owner (admin): no Add button, no confidential fields — but roles.
  await owner.getByRole("link", { name: "Directory" }).click();
  await expect(owner.getByTestId("people-page")).toBeVisible();
  await expect(owner.getByTestId("people-add-staff")).toHaveCount(0);
  await owner.getByTestId(`person-row-${staffEmail}`).click();
  await expect(owner.getByTestId("person-details")).toContainText("Sales associate");
  await expect(owner.getByTestId("person-details")).not.toContainText("+383 44 123 456");
  await expect(owner.getByTestId("person-status-toggle")).toHaveCount(0);

  await owner.getByRole("link", { name: "People" }).click();
  await owner.getByTestId(`person-row-${miloEmail}`).click();
  const roleSet = owner.waitForResponse((res) => res.url().includes("people.setRole"));
  await owner.locator("#person-role").selectOption("operations_manager");
  expect((await roleSet).ok()).toBe(true);
  await expect(owner.locator("#person-role")).toHaveValue("operations_manager");

  // Every HR user is told, in-app.
  await hr.reload();
  await hr.getByLabel("Notifications").click();
  await expect(hr.getByText("changed roles: Milo Manager is now Operations Manager")).toBeVisible();

  // An admin who isn't the owner still can't make themselves HR.
  const admin = await seedMember(workspaceId, "Ada Admin", "admin");
  const adminPage = await pageAs(browser, admin, workspaceId);
  const selfGrant = await adminPage.request.post("/trpc/people.setRole", {
    data: { workspaceId, userId: admin.userId, peopleRole: "hr_finance" },
  });
  expect(selfGrant.status()).toBe(403);
  // …and HR can't assign roles at all.
  const hrGrant = await hr.request.post("/trpc/people.setRole", {
    data: { workspaceId, userId: admin.userId, peopleRole: "employee" },
  });
  expect(hrGrant.status()).toBe(403);

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
  await hr.goto(`/w/${workspaceId}/people`);
  await hr.getByTestId(`person-row-${staffEmail}`).click();
  const statusSet = hr.waitForResponse((res) => res.url().includes("people.setStatus"));
  await hr.getByTestId("person-status-toggle").click();
  await statusSet;
  await expect(hr.getByTestId("person-profile")).toContainText("Deactivated");
  await staff.goto("/");
  await expect(staff.getByText(staffEmail)).toBeVisible();
  await expect(staff.getByRole("link", { name: "Open" })).toHaveCount(0);

  await adminPage.context().close();
  await hr.context().close();
  await staffContext.close();
});
