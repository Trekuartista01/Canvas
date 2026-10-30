import { db, schema } from "@canvas/db";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

const PASSWORD = "initial-pass-123";
const IBAN = "XK051212012345678906";
const ID_CARD = "1234567890";

async function addPerson(page: Page, name: string, role: string) {
  const email = uniqueEmail(role);
  await page.getByRole("link", { name: "Directory" }).click();
  await page.getByTestId("people-add-staff").click();
  const form = page.getByTestId("add-staff-form");
  await form.getByLabel("Full name").fill(name);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Initial password").fill(PASSWORD);
  await form.getByLabel("Role").selectOption(role);
  const created = page.waitForResponse((res) => res.url().includes("people.createStaff"));
  await page.getByTestId("add-staff-submit").click();
  expect((await created).ok()).toBe(true);
  return email;
}

test("M7.7 payroll: HR edits encrypted pay details, exports, everything audited; staff see only their own, masked", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  await signUp(page, "Hana HR");
  await createWorkspaceAndOpen(page, "Payroll Workspace");
  const workspaceId = page.url().match(/\/w\/([^/]+)/)![1]!;
  const samEmail = await addPerson(page, "Sam Staff", "staff");
  const moEmail = await addPerson(page, "Mo Manager", "staff_manager");

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
  await page.getByRole("button", { name: "Audit trail" }).click();
  const audit = page.getByTestId("payroll-audit");
  await expect(audit).toContainText("changed the record of Sam Staff");
  await expect(audit).toContainText("viewed the record of Sam Staff");
  await expect(audit).toContainText("exported payroll as XLSX");
  await expect(audit).toContainText("exported payroll as PDF");
  await expect(audit).not.toContainText("8906");

  // Sam: own details only, masked; no payroll table, export refused.
  const samContext = await browser.newContext();
  const samPage = await samContext.newPage();
  await logIn(samPage, samEmail, PASSWORD);
  await samPage.getByRole("link", { name: "Open" }).click();
  await expect(samPage.getByRole("link", { name: "Payroll", exact: true })).toHaveCount(0);
  await samPage.getByRole("link", { name: "My pay details" }).click();
  const details = samPage.getByTestId("my-pay-details");
  await expect(details).toContainText("650,50");
  await expect(details).toContainText("•••• 8906");
  await expect(details).toContainText("•••• 7890");
  await expect(details).not.toContainText(IBAN);
  expect((await samPage.request.get(`/payroll-export/${workspaceId}/payroll.xlsx`)).status()).toBe(
    403,
  );

  // A staff manager doesn't see payroll either.
  const moContext = await browser.newContext();
  const moPage = await moContext.newPage();
  await logIn(moPage, moEmail, PASSWORD);
  await moPage.getByRole("link", { name: "Open" }).click();
  await expect(moPage.getByRole("link", { name: "Directory" })).toBeVisible();
  await expect(moPage.getByRole("link", { name: "Payroll", exact: true })).toHaveCount(0);
  expect((await moPage.request.get(`/payroll-export/${workspaceId}/payroll.pdf`)).status()).toBe(
    403,
  );

  await samContext.close();
  await moContext.close();
});
