import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

const DOC_FIXTURE = fileURLToPath(new URL("../fixtures/test-doc.txt", import.meta.url));
const IMAGE_FIXTURE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));
const PASSWORD = "initial-pass-123";

async function addStaff(page: Page, name: string) {
  const email = uniqueEmail("staff");
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
  return email;
}

async function fileContract(
  page: Page,
  c: {
    person: string;
    kind?: string;
    parent?: string;
    title: string;
    start: string;
    expiry?: string;
  },
) {
  await page.getByTestId("contract-add").click();
  const form = page.getByTestId("contract-form");
  await form.getByLabel("Employee").selectOption({ label: c.person });
  if (c.kind) await form.getByLabel("Kind").selectOption(c.kind);
  if (c.parent) await form.getByLabel("Belongs to").selectOption({ label: c.parent });
  await form.getByLabel("Title").fill(c.title);
  await form.getByLabel("Start date").fill(c.start);
  if (c.expiry) await form.getByLabel("Expiry date (optional)").fill(c.expiry);
  await form.getByLabel("File").setInputFiles(DOC_FIXTURE);
  const created = page.waitForResponse((res) => res.url().includes("contract.create"));
  await form.getByTestId("contract-save").click();
  expect((await created).ok()).toBe(true);
  await expect(page.getByTestId(`contract-row-${c.title}`)).toBeVisible();
}

test("M7.6 documents: HR files contracts, each employee sees only their own; company library with versions", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  await signUp(page, "Hana HR");
  await createWorkspaceAndOpen(page, "Documents Workspace");
  const samEmail = await addStaff(page, "Sam Staff");
  await addStaff(page, "Tina Other");

  await page.getByRole("link", { name: "Contracts" }).click();
  await expect(page.getByTestId("contracts-page")).toBeVisible();
  await fileContract(page, {
    person: "Sam Staff",
    title: "Employment contract 2026",
    start: "2026-01-01",
    expiry: "2030-12-31",
  });
  await fileContract(page, {
    person: "Sam Staff",
    kind: "annex",
    parent: "Employment contract 2026",
    title: "Salary annex",
    start: "2026-06-01",
  });
  await fileContract(page, { person: "Tina Other", title: "Tina's contract", start: "2026-02-01" });

  // HR replaces the annex file — a new upload, same record.
  const replaced = page.waitForResponse((res) => res.url().includes("contract.update"));
  await page.getByLabel("Replace Salary annex").setInputFiles(IMAGE_FIXTURE);
  expect((await replaced).ok()).toBe(true);

  // Company library: a category, a document, then a second version.
  await page.getByRole("link", { name: "Company documents" }).click();
  await page.getByLabel("New category").fill("Policies");
  await page.getByRole("button", { name: "Add category" }).click();
  const form = page.getByTestId("company-document-form");
  await expect(form.getByLabel("Category")).toContainText("Policies");
  await form.getByLabel("Document title").fill("Leave policy");
  await form.getByLabel("Category").selectOption({ label: "Policies" });
  await form.getByLabel("Document file").setInputFiles(DOC_FIXTURE);
  const docCreated = page.waitForResponse((res) => res.url().includes("companyDocument.create"));
  await form.getByTestId("company-document-save").click();
  expect((await docCreated).ok()).toBe(true);
  const doc = page.getByTestId("company-document-Leave policy");
  await expect(doc).toContainText("test-doc.txt");

  const versioned = page.waitForResponse((res) => res.url().includes("companyDocument.replace"));
  await page.getByLabel("Replace Leave policy").setInputFiles(IMAGE_FIXTURE);
  expect((await versioned).ok()).toBe(true);
  await expect(doc).toContainText("test-image.png");
  await doc.getByRole("button", { name: "Version 2" }).click();
  await expect(doc.getByTestId("document-versions")).toContainText("v1");
  await expect(doc.getByTestId("document-versions")).toContainText("current");

  // Sam: only his own contract + annex, and he can download them.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await logIn(staff, samEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await expect(staff.getByRole("link", { name: "Contracts", exact: true })).toHaveCount(0);
  await staff.getByRole("link", { name: "My contract" }).click();
  const list = staff.getByTestId("my-contract-list");
  await expect(list).toContainText("Employment contract 2026");
  await expect(list).toContainText("Salary annex");
  await expect(list).not.toContainText("Tina");

  const contractDownload = staff.waitForEvent("download");
  await staff
    .getByTestId("contract-Employment contract 2026")
    .getByRole("button", { name: "Download" })
    .click();
  expect((await contractDownload).suggestedFilename()).toBe("test-doc.txt");

  // The replaced annex downloads as the new file.
  const annexDownload = staff.waitForEvent("download");
  await staff
    .getByTestId("contract-Salary annex")
    .getByRole("button", { name: "Download" })
    .click();
  expect((await annexDownload).suggestedFilename()).toBe("test-image.png");

  // Everyone reads the company library, nobody else manages it.
  await staff.getByRole("link", { name: "Company documents" }).click();
  await expect(staff.getByTestId("company-document-form")).toHaveCount(0);
  const staffDoc = staff.getByTestId("company-document-Leave policy");
  await expect(staffDoc).toBeVisible();
  const docDownload = staff.waitForEvent("download");
  await staffDoc.getByRole("button", { name: "Download" }).click();
  expect((await docDownload).suggestedFilename()).toBe("test-image.png");

  await staffContext.close();
});
