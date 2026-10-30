import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

const CLIP_FIXTURE = fileURLToPath(new URL("../fixtures/test-clip.webm", import.meta.url));

test("M4.6 clips: upload a screen-recording clip, play it, reload, and delete", async ({
  page,
}) => {
  await signUp(page, "Clips Tester");
  await createWorkspaceAndOpen(page, "Clips Workspace");
  await createSpaceAndList(page, "Support", "Bug Reports");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Repro the crash");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Repro the crash" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Repro the crash");

  // Uploads now go straight to storage (attachment.presignUpload + a
  // direct PUT + attachment.confirmUpload) rather than a single POST
  // /uploads — confirmUpload is the step that actually creates the
  // attachments row.
  const clipUploaded = page.waitForResponse((res) =>
    res.url().includes("attachment.confirmUpload"),
  );
  await page.getByLabel("Upload clip").setInputFiles(CLIP_FIXTURE);
  await clipUploaded;
  await expect(page.getByText("Clips (1)")).toBeVisible();

  const video = page.getByTestId(/^clip-video-/);
  await expect(video).toBeVisible();
  // A real, playable video element — not just a link — that loaded its
  // metadata from the server (videoWidth only populates once it has).
  await expect(video).toHaveJSProperty("videoWidth", 64, { timeout: 15_000 });

  // reload and reopen to confirm the clip persisted server-side
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Repro the crash" }).click();
  await expect(page.getByText("Clips (1)")).toBeVisible();
  await expect(page.getByTestId(/^clip-video-/)).toBeVisible();

  await page.getByTestId(/^clip-video-/).hover();
  const deleted = page.waitForResponse((res) => res.url().includes("attachment.delete"));
  await page.getByRole("button", { name: "Delete test-clip.webm" }).click();
  await deleted;
  await expect(page.getByText("Clips (1)")).toHaveCount(0);
});
