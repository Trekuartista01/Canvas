import { db, schema } from "@canvas/db";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
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
  await expect(owner.getByTestId("person-archive")).toHaveCount(0);
  await expect(owner.getByRole("tab", { name: "Confidential" })).toHaveCount(0);

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

  // Sam signs in: lands on My Tasks; the directory is everyone's (P8.3),
  // the manager-only sections aren't.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, staffEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await expect(staff.getByTestId("my-tasks-page")).toBeVisible();
  await expect(staff).toHaveURL(/\/my-tasks$/);
  await expect(staff.getByRole("link", { name: "My Tasks" })).toBeVisible();
  await expect(staff.getByRole("link", { name: "Directory" })).toBeVisible();
  await expect(staff.getByRole("link", { name: "Home", exact: true })).toHaveCount(0);

  // HR archives Sam: the workspace disappears for him, history stays.
  await hr.goto(`/w/${workspaceId}/people`);
  await hr.getByTestId(`person-row-${staffEmail}`).click();
  const archived = hr.waitForResponse((res) => res.url().includes("people.archive"));
  await hr.getByTestId("person-archive-button").click();
  expect((await archived).ok()).toBe(true);
  await expect(hr.getByTestId("person-profile")).toContainText("Archived");
  await staff.goto("/");
  await expect(staff.getByText(staffEmail)).toBeVisible();
  await expect(staff.getByRole("link", { name: "Open" })).toHaveCount(0);

  await adminPage.context().close();
  await hr.context().close();
  await staffContext.close();
});

test("People (P8.3): everyone has the directory, HR keeps the Confidential tab, archives and deletes", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(120_000);

  await signUp(owner, "Olive Owner");
  await createWorkspaceAndOpen(owner, "Confidential Workspace");
  const workspaceId = workspaceIdFrom(owner);
  const { hr: hrMember, hrPage: hr } = await openAsHr(browser, workspaceId);
  const sam = await seedMember(workspaceId, "Sam Staff", "employee");
  const erin = await seedMember(workspaceId, "Erin Employee", "employee");

  // HR fills in Sam's confidential terms.
  await hr.goto(`/w/${workspaceId}/people/${sam.userId}`);
  await hr.getByRole("tab", { name: "Confidential" }).click();
  const terms = hr.getByTestId("person-terms-form");
  await terms.getByLabel("Personal number").fill("1234567890");
  await terms.getByLabel("Gross salary").fill("950");
  await terms.getByLabel("Net salary").fill("800.50");
  await terms.getByLabel("Contract type").selectOption("fixed_term");
  await terms.getByLabel("Contract start").fill("2026-01-01");
  await terms.getByLabel("Contract end").fill("2026-12-31");
  const saved = hr.waitForResponse((res) => res.url().includes("people.updateConfidential"));
  await terms.getByTestId("person-terms-save").click();
  expect((await saved).ok()).toBe(true);

  // …and Sam's 2027 allowance (default 20) becomes 25.
  const allowance = hr.getByTestId("allowance-2027");
  const balanceSet = hr.waitForResponse((res) => res.url().includes("leave.setBalance"));
  await allowance.getByLabel("Allowed days 2027").fill("25");
  await allowance.getByLabel("Allowed days 2027").blur();
  expect((await balanceSet).ok()).toBe(true);

  await hr.reload();
  await hr.getByRole("tab", { name: "Confidential" }).click();
  await expect(hr.getByTestId("person-terms-form").getByLabel("Personal number")).toHaveValue(
    "1234567890",
  );
  await expect(hr.getByTestId("person-terms-form").getByLabel("Gross salary")).toHaveValue("950");
  await expect(hr.getByLabel("Allowed days 2027")).toHaveValue("25");
  // Stored encrypted, never in plain text.
  const profileRow = await db
    .select({ enc: schema.employeeProfiles.personalNumberEnc })
    .from(schema.employeeProfiles)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.employeeProfiles.membershipId))
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        eq(schema.memberships.userId, sam.userId),
      ),
    );
  expect(profileRow[0]?.enc).toBeTruthy();
  expect(profileRow[0]?.enc).not.toContain("1234567890");

  // Erin (an employee) has the directory and Sam's public profile — no tab,
  // and the API refuses the confidential part.
  const erinPage = await pageAs(browser, erin, workspaceId);
  await erinPage.getByRole("link", { name: "Directory" }).click();
  await expect(erinPage.getByTestId("people-page")).toBeVisible();
  await expect(erinPage.getByTestId("people-add-staff")).toHaveCount(0);
  await erinPage.getByTestId(`person-row-${sam.email}`).click();
  await expect(erinPage.getByRole("heading", { name: "Sam Staff" })).toBeVisible();
  await expect(erinPage.getByRole("tab", { name: "Confidential" })).toHaveCount(0);
  const peek = await erinPage.request.get(
    `/trpc/people.confidential?input=${encodeURIComponent(JSON.stringify({ workspaceId, userId: sam.userId }))}`,
  );
  expect(peek.status()).toBe(403);

  // HR can't edit their own confidential details.
  await hr.goto(`/w/${workspaceId}/people/${hrMember.userId}`);
  await hr.getByRole("tab", { name: "Confidential" }).click();
  await expect(hr.getByTestId("person-terms-save")).toHaveCount(0);

  // Remove = archive: Sam leaves the directory (HR sees him with the filter),
  // and his profile is gone for everyone else.
  await hr.goto(`/w/${workspaceId}/people/${sam.userId}`);
  const archived = hr.waitForResponse((res) => res.url().includes("people.archive"));
  await hr.getByTestId("person-archive-button").click();
  expect((await archived).ok()).toBe(true);
  await expect(hr.getByTestId("person-profile")).toContainText("Archived");
  await erinPage.goto(`/w/${workspaceId}/people`);
  await expect(erinPage.getByTestId("people-page")).toBeVisible();
  await expect(erinPage.getByTestId(`person-row-${sam.email}`)).toHaveCount(0);
  await erinPage.goto(`/w/${workspaceId}/people/${sam.userId}`);
  await expect(erinPage.getByText("You don't have access to this profile")).toBeVisible();
  await hr.goto(`/w/${workspaceId}/people`);
  await expect(hr.getByTestId(`person-row-${sam.email}`)).toHaveCount(0);
  await hr.getByTestId("people-status-filter").selectOption("all");
  await expect(hr.getByTestId(`person-row-${sam.email}`)).toContainText("Archived");

  // Records stay while archived; deleting permanently removes them.
  await hr.getByTestId(`person-row-${sam.email}`).click();
  await hr.getByTestId("person-delete").click();
  const deleted = hr.waitForResponse((res) => res.url().includes("people.deletePermanently"));
  await hr.getByTestId("person-delete-confirm").click();
  expect((await deleted).ok()).toBe(true);
  await expect(hr.getByTestId("people-page")).toBeVisible();
  await hr.getByTestId("people-status-filter").selectOption("all");
  await expect(hr.getByTestId(`person-row-${sam.email}`)).toHaveCount(0);
  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(schema.memberships.workspaceId, workspaceId),
      eq(schema.memberships.userId, sam.userId),
    ),
  });
  expect(membership).toBeUndefined();
  const pay = await db.query.payrollRecords.findFirst({
    where: and(
      eq(schema.payrollRecords.workspaceId, workspaceId),
      eq(schema.payrollRecords.userId, sam.userId),
    ),
  });
  expect(pay).toBeUndefined();

  await erinPage.context().close();
  await hr.context().close();
});
