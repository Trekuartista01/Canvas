import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db, schema } from "@canvas/db";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createWorkspaceAndOpen, pageAs, seedMember, signUp, workspaceIdFrom } from "./helpers";

const IMAGE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));
const PDF = fileURLToPath(new URL("../fixtures/test-contract.pdf", import.meta.url));
const NOT_ALLOWED = fileURLToPath(new URL("../fixtures/test-doc.txt", import.meta.url));

/** A real drop event, the way a file dragged in from the desktop arrives. */
async function dropFile(zone: Locator, path: string, name: string, type: string) {
  const base64 = readFileSync(path).toString("base64");
  await zone.evaluate(
    (el, file) => {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true }));
    },
    { base64, name, type },
  );
}

async function imageLoaded(image: Locator) {
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
}

async function save(page: Page, testId: string, procedure: string) {
  const done = page.waitForResponse((res) => res.url().includes(procedure));
  await page.getByTestId(testId).click();
  expect((await done).ok()).toBe(true);
}

test("P8.6 Contracts page: drag-and-drop with preview, signed viewing, replace and delete with confirmation", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(120_000);

  await signUp(owner, "Olsi Owner");
  await createWorkspaceAndOpen(owner, "Contracts Page Workspace");
  const ws = workspaceIdFrom(owner);
  const hana = await seedMember(ws, "Hana HR", "hr_finance");
  const sam = await seedMember(ws, "Sam Staff", "employee");
  await seedMember(ws, "Tina Other", "employee");
  const hr = await pageAs(browser, hana, ws);

  await hr.getByRole("link", { name: "Contracts" }).click();
  const samRow = hr.getByTestId("contract-person-Sam Staff");
  await expect(samRow).toContainText("No contract filed");
  await expect(hr.getByTestId("contract-person-Tina Other")).toBeVisible();

  await samRow.click();
  await expect(hr).toHaveURL(new RegExp(`person=${sam.userId}`));
  await hr.getByTestId("contract-add").click();
  const form = hr.getByTestId("contract-form");
  await form.getByLabel("Contract type").selectOption("fixed_term");
  await form.getByLabel("Title").fill("Employment contract");
  await form.getByLabel("Start date").fill("2026-01-01");
  const endDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await form.getByLabel("End date (optional)").fill(endDate);

  // A wrong type is refused on the spot; nothing is uploaded without a file.
  await form.getByLabel("Contract files").setInputFiles(NOT_ALLOWED);
  await expect(form.getByRole("alert")).toContainText("contracts can be JPG, PNG, HEIC or PDF");
  await expect(form.getByTestId("contract-pending-files")).toHaveCount(0);

  // Dropped and chosen files are both previewed before saving.
  await dropFile(form.getByTestId("contract-dropzone"), IMAGE, "page-1.png", "image/png");
  await form.getByLabel("Contract files").setInputFiles(PDF);
  await imageLoaded(form.getByRole("img", { name: "Preview of page-1.png" }));
  await expect(form.getByTestId("contract-pending-test-contract.pdf")).toBeVisible();

  // Removing a pending file keeps it out of the upload.
  await form.getByLabel("Contract files").setInputFiles(IMAGE);
  await form.getByRole("button", { name: "Remove test-image.png" }).click();
  await expect(form.getByTestId("contract-pending-test-image.png")).toHaveCount(0);

  await save(hr, "contract-save", "contract.create");

  const card = hr.getByTestId("contract-row-Employment contract");
  await expect(card).toContainText("Fixed-term");
  await expect(card).toContainText("Ending soon");
  await expect(card.getByTestId("contract-end")).toHaveText(endDate.split("-").reverse().join("."));
  await expect(samRow).toContainText("Ending soon");
  await expect(samRow).toContainText("1 document");
  const imageFile = card.getByTestId("contract-file-page-1.png");
  await expect(imageFile).toContainText("Hana HR");
  await imageLoaded(imageFile.getByRole("img"));

  // Full-screen preview, from a signed link, across the contract's files.
  await imageFile.getByRole("button", { name: "Open page-1.png" }).click();
  const viewer = hr.getByTestId("contract-file-viewer");
  await imageLoaded(viewer.getByRole("img", { name: "page-1.png" }));
  await viewer.getByRole("button", { name: "Next file" }).click();
  await expect(viewer.locator("iframe")).toHaveAttribute("src", /test-contract\.pdf/);
  await expect(viewer).toContainText("2 of 2");
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toHaveCount(0);

  const download = hr.waitForEvent("download");
  await card.getByRole("button", { name: "Download test-contract.pdf" }).click();
  expect((await download).suggestedFilename()).toBe("test-contract.pdf");

  // Replacing a file re-arms the end-date alert.
  const [row] = await db
    .update(schema.employmentContracts)
    .set({ endAlertSentAt: new Date() })
    .where(eq(schema.employmentContracts.userId, sam.userId))
    .returning({ id: schema.employmentContracts.id });
  const replaced = hr.waitForResponse((res) => res.url().includes("contract.replaceFile"));
  await card.getByLabel("Replace page-1.png").setInputFiles(IMAGE);
  expect((await replaced).ok()).toBe(true);
  await expect(card.getByTestId("contract-file-test-image.png")).toBeVisible();
  await expect(card.getByTestId("contract-file-page-1.png")).toHaveCount(0);
  const rearmed = await db.query.employmentContracts.findFirst({
    where: eq(schema.employmentContracts.id, row!.id),
  });
  expect(rearmed?.endAlertSentAt).toBeNull();

  // More pages later.
  await card.getByRole("button", { name: "Add pages" }).click();
  const more = card.getByTestId("contract-add-files");
  await dropFile(more.getByTestId("contract-dropzone"), IMAGE, "page-3.png", "image/png");
  await save(hr, "contract-add-files-save", "contract.addFiles");
  await expect(card.getByTestId("contract-file-page-3.png")).toBeVisible();

  // Deleting asks first, and Cancel keeps the file.
  const third = card.getByTestId("contract-file-page-3.png");
  await third.getByRole("button", { name: "Delete page-3.png" }).click();
  await third.getByRole("button", { name: "Cancel" }).click();
  await expect(third).toBeVisible();
  await third.getByRole("button", { name: "Delete page-3.png" }).click();
  const fileGone = hr.waitForResponse((res) => res.url().includes("contract.deleteFile"));
  await third.getByRole("button", { name: "Yes, delete" }).click();
  expect((await fileGone).ok()).toBe(true);
  await expect(third).toHaveCount(0);

  // Editing the end date moves it out of "Ending soon".
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByLabel("End date").fill("2031-03-01");
  await save(hr, "contract-edit-save", "contract.update");
  await expect(card.getByTestId("contract-end")).toHaveText("01.03.2031");
  await expect(card).not.toContainText("Ending soon");
  await expect(samRow).not.toContainText("Ending soon");

  // Everything that mattered is in the audit log.
  const audit = await db
    .select({ action: schema.auditLog.action })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.workspaceId, ws), eq(schema.auditLog.entityId, row!.id)));
  expect(audit.map((a) => a.action)).toEqual(
    expect.arrayContaining([
      "contract.created",
      "contract.file_viewed",
      "contract.downloaded",
      "contract.file_replaced",
      "contract.files_added",
      "contract.file_deleted",
      "contract.updated",
    ]),
  );

  // Sam's own page lists both files; the signed-link route is the only way in.
  const staff = await pageAs(browser, sam, ws);
  await staff.getByRole("link", { name: "My contract" }).click();
  const mine = staff.getByTestId("contract-Employment contract");
  await expect(mine.getByRole("button", { name: "Download test-image.png" })).toBeVisible();
  await expect(mine.getByRole("button", { name: "Download test-contract.pdf" })).toBeVisible();
  const [attachment] = await db
    .select({ id: schema.contractFiles.attachmentId })
    .from(schema.contractFiles)
    .where(eq(schema.contractFiles.contractId, row!.id))
    .limit(1);
  expect((await staff.request.get(`/uploads/${attachment!.id}`)).status()).toBe(403);

  // Deleting the document asks first too.
  await card.getByRole("button", { name: "Delete Employment contract" }).click();
  const gone = hr.waitForResponse((res) => res.url().includes("contract.delete"));
  await card.getByRole("button", { name: "Yes, delete" }).click();
  expect((await gone).ok()).toBe(true);
  await expect(card).toHaveCount(0);
  await expect(samRow).toContainText("No contract filed");
});
