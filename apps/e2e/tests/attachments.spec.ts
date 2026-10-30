import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

const IMAGE_FIXTURE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));
const DOC_FIXTURE = fileURLToPath(new URL("../fixtures/test-doc.txt", import.meta.url));

test("upload an image and a file to a task, open the lightbox, reload, and delete", async ({
  page,
}) => {
  await signUp(page, "Attachment Tester");
  await createWorkspaceAndOpen(page, "Attachment Workspace");
  await createSpaceAndList(page, "Design", "Sprint");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Design homepage");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Design homepage" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Design homepage");

  // Uploads now go straight to storage (attachment.presignUpload + a
  // direct PUT + attachment.confirmUpload) rather than a single POST
  // /uploads — confirmUpload is the step that actually creates the
  // attachments row, so it's what the list update waits on.
  const isConfirmUpload = (res: import("@playwright/test").Response) =>
    res.url().includes("attachment.confirmUpload");

  const imageUploaded = page.waitForResponse(isConfirmUpload);
  await page.getByLabel("Upload attachment").setInputFiles(IMAGE_FIXTURE);
  await imageUploaded;
  await expect(page.getByText("Attachments (1)")).toBeVisible();

  const docUploaded = page.waitForResponse(isConfirmUpload);
  await page.getByLabel("Upload attachment").setInputFiles(DOC_FIXTURE);
  await docUploaded;
  await expect(page.getByText("Attachments (2)")).toBeVisible();
  await expect(page.getByRole("link", { name: /test-doc\.txt/ })).toBeVisible();

  // lightbox: open the image thumb, confirm the full-res original loads, close it
  await page.getByRole("button", { name: /Open test-image\.png/ }).click();
  const lightbox = page.getByTestId("lightbox");
  const lightboxImage = lightbox.getByRole("img", { name: "test-image.png" });
  await expect(lightboxImage).toBeVisible();
  await expect(lightboxImage).toHaveJSProperty("complete", true);
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);

  // reload and reopen to confirm both attachments persisted server-side
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Design homepage" }).click();
  await expect(page.getByText("Attachments (2)")).toBeVisible();
  await expect(page.getByRole("link", { name: /test-doc\.txt/ })).toBeVisible();

  // delete the file attachment, leaving only the image — the delete button
  // only appears on hover (same "group-hover" convention as checklist/tag rows)
  await page.getByRole("link", { name: /test-doc\.txt/ }).hover();
  const deleted = page.waitForResponse((res) => res.url().includes("attachment.delete"));
  await page.getByRole("button", { name: "Delete test-doc.txt" }).click();
  await deleted;
  await expect(page.getByText("Attachments (1)")).toBeVisible();
  await expect(page.getByRole("link", { name: /test-doc\.txt/ })).toHaveCount(0);
});
