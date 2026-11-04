import { db, schema } from "@canvas/db";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  createWorkspaceAndOpen,
  logIn,
  openAsHr,
  signUp,
  uniqueEmail,
  workspaceIdFrom,
} from "./helpers";

const PASSWORD = "initial-pass-123";
const IBAN = "XK051212012345678906";
const ID_CARD = "1234567890";

async function addPerson(page: Page, name: string) {
  const email = uniqueEmail("staff");
  await page.getByRole("link", { name: "Directory" }).click();
  await page.getByTestId("people-add-staff").click();
  const form = page.getByTestId("add-staff-form");
  await form.getByLabel("Full name").fill(name);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Initial password").fill(PASSWORD);
  const created = page.waitForResponse((res) => res.url().includes("people.createStaff"));
  await page.getByTestId("add-staff-submit").click();
  expect((await created).ok()).toBe(true);
  return email;
}

test("M7.7 payroll: HR edits encrypted pay details, exports, everything audited; staff see only their own, masked; admin sees none of it", async ({
  page: ownerPage,
  browser,
}) => {
  test.setTimeout(150_000);

  await signUp(ownerPage, "Olsi Owner");
  await createWorkspaceAndOpen(ownerPage, "Payroll Workspace");
  const workspaceId = workspaceIdFrom(ownerPage);
  // P8.1: the owner is admin, never HR — payroll is done by an HR user.
  const { hrPage: page } = await openAsHr(browser, workspaceId);
  const samEmail = await addPerson(page, "Sam Staff");

  // HR fills in Sam's record from the table's drawer.
  await page.getByRole("link", { name: "Payroll" }).click();
  await page.getByTestId("payroll-row-Sam Staff").click();
  const drawer = page.getByTestId("payroll-drawer");
  await drawer.getByLabel("Net salary (EUR / month)").fill("650.50");
  await drawer.getByLabel("ID card number").fill(ID_CARD);
  await drawer.getByLabel("Bank").fill("Banka Kombëtare");
  await drawer.getByLabel("IBAN").fill("XK05 1212 0123 4567 8907");
  await expect(drawer).toContainText("That IBAN isn't valid");
  await expect(drawer.getByTestId("payroll-save")).toBeDisabled();
  await drawer.getByLabel("IBAN").fill("xk05 1212 0123 4567 8906");
  const saved = page.waitForResponse((res) => res.url().includes("payroll.upsert"));
  await drawer.getByTestId("payroll-save").click();
  expect((await saved).ok()).toBe(true);
  await expect(drawer).toHaveCount(0);

  // The table masks the secrets; the drawer shows them in full again.
  const row = page.getByTestId("payroll-row-Sam Staff");
  await expect(row).toContainText("•••• 8906");
  await expect(row).toContainText("•••• 7890");
  await expect(row).not.toContainText(IBAN);
  await expect(page.getByTestId("payroll-total")).toContainText("650,50");
  await row.click();
  await expect(page.getByTestId("payroll-drawer").getByLabel("IBAN")).toHaveValue(
    "XK05 1212 0123 4567 8906",
  );
  await page.keyboard.press("Escape");

  // Stored encrypted: neither value appears in the row.
  const sam = await db.query.users.findFirst({ where: eq(schema.users.email, samEmail) });
  const stored = await db.query.payrollRecords.findFirst({
    where: eq(schema.payrollRecords.userId, sam!.id),
  });
  expect(stored!.ibanEnc!.startsWith("v1.")).toBe(true);
  expect(JSON.stringify(stored)).not.toContain("8906");
  expect(JSON.stringify(stored)).not.toContain(ID_CARD);
  expect(stored!.netSalaryEur).toBe(650.5);

  // Both exports download with the full values.
  const xlsx = await page.request.get(`/payroll-export/${workspaceId}/payroll.xlsx`);
  expect(xlsx.ok()).toBe(true);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  const pdf = await page.request.get(`/payroll-export/${workspaceId}/payroll.pdf`);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // The audit trail recorded the edit (field names only), views and exports.
  await page.getByRole("button", { name: "Access log" }).click();
  const audit = page.getByTestId("hr-access-log");
  await expect(audit).toContainText("changed the record of Sam Staff");
  await expect(audit).toContainText("viewed the record of Sam Staff");
  await expect(audit).toContainText("exported payroll as XLSX");
  await expect(audit).toContainText("exported payroll as PDF");
  await expect(audit).not.toContainText("8906");

  // Amounts are in the person's pay currency, and never summed across currencies.
  const [membership] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, sam!.id)),
    );
  await db
    .insert(schema.employeeProfiles)
    .values({ membershipId: membership!.id, payCurrency: "USD" })
    .onConflictDoUpdate({
      target: schema.employeeProfiles.membershipId,
      set: { payCurrency: "USD" },
    });
  await page.reload();
  await expect(page.getByTestId("payroll-row-Sam Staff")).toContainText("650,50 $");
  await expect(page.getByTestId("payroll-total")).toContainText("650,50 $");
  await page.getByTestId("payroll-row-Sam Staff").click();
  await expect(
    page.getByTestId("payroll-drawer").getByLabel("Net salary (USD / month)"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Sam: own details only, masked; no payroll table, export refused.
  const samContext = await browser.newContext();
  const samPage = await samContext.newPage();
  await logIn(samPage, samEmail, PASSWORD);
  await samPage.getByRole("link", { name: "Open" }).click();
  await expect(samPage.getByRole("link", { name: "Payroll", exact: true })).toHaveCount(0);

  // Opening the URL directly: the page isn't there, and neither is its data.
  await samPage.goto(`/w/${workspaceId}/payroll`);
  await expect(samPage.getByTestId("no-access")).toBeVisible();

  // Spec §8: nothing about pay is requested until Open is clicked.
  await samPage.goto(`/w/${workspaceId}`);
  const payRequests: string[] = [];
  const bodies: string[] = [];
  samPage.on("request", (req) => {
    if (req.url().includes("payroll.")) payRequests.push(req.url());
  });
  samPage.on("response", (res) => {
    if (res.url().includes("/trpc/")) {
      bodies.push(res.url());
      void res.text().then(
        (text) => bodies.push(text),
        () => undefined,
      );
    }
  });
  await samPage.getByRole("link", { name: "My pay details" }).click();
  const confirm = samPage.getByTestId("my-pay-confirm");
  await expect(confirm).toContainText("Kjo faqe përmban informacione konfidenciale.");
  await expect(confirm).toContainText("This page contains confidential information.");
  await samPage.waitForLoadState("networkidle");
  expect(payRequests).toEqual([]);
  expect(bodies.join("\n")).not.toContain("650.5");
  await expect(samPage.getByTestId("my-pay-details")).toHaveCount(0);

  // Cancel goes back, still with nothing fetched.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(samPage).not.toHaveURL(/my-pay/);
  expect(payRequests).toEqual([]);

  // It asks every time, and Open is what fetches.
  await samPage.getByRole("link", { name: "My pay details" }).click();
  await expect(confirm).toBeVisible();
  const fetched = samPage.waitForResponse((res) => res.url().includes("payroll.mine"));
  await confirm.getByRole("button", { name: "Open" }).click();
  expect((await fetched).ok()).toBe(true);
  await expect(confirm).toHaveCount(0);
  const details = samPage.getByTestId("my-pay-details");
  await expect(details).toContainText("650,50 $");
  await expect(details).toContainText("•••• 8906");
  await expect(details).toContainText("•••• 7890");
  await expect(details).not.toContainText(IBAN);

  // Hide blurs the amounts again; Show brings them back without another fetch.
  const salary = samPage.getByTestId("my-pay-value-Net salary");
  const countBefore = payRequests.length;
  await samPage.getByTestId("my-pay-hide").click();
  await expect(salary).toHaveClass(/blur-sm/);
  await samPage.getByTestId("my-pay-hide").click();
  await expect(salary).not.toHaveClass(/blur-sm/);
  expect(payRequests.length).toBe(countBefore);

  // Leaving and coming back asks again, even though the data was just loaded.
  await samPage.getByRole("link", { name: "My Tasks" }).click();
  await samPage.getByRole("link", { name: "My pay details" }).click();
  await expect(samPage.getByTestId("my-pay-confirm")).toBeVisible();
  await expect(samPage.getByTestId("my-pay-details")).toHaveCount(0);

  // The API goes by the session: a user id in the request is ignored.
  const forged = await samPage.request.get(
    `/trpc/payroll.mine?input=${encodeURIComponent(
      JSON.stringify({ workspaceId, userId: "00000000-0000-7000-8000-000000000000" }),
    )}`,
  );
  expect(forged.ok()).toBe(true);
  expect(await forged.text()).toContain("650.5");
  expect((await samPage.request.get(`/payroll-export/${workspaceId}/payroll.xlsx`)).status()).toBe(
    403,
  );

  // The owner (admin) doesn't see payroll either — no admin bypass (P8.1).
  await ownerPage.reload();
  await expect(ownerPage.getByRole("link", { name: "Directory" })).toBeVisible();
  await expect(ownerPage.getByRole("link", { name: "Payroll", exact: true })).toHaveCount(0);
  expect((await ownerPage.request.get(`/payroll-export/${workspaceId}/payroll.pdf`)).status()).toBe(
    403,
  );

  await samContext.close();
});
