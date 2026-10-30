import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("Brain chat: send from task panel, stream reply, persist across reload; global Brain opens", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Brain Tester");
  await createWorkspaceAndOpen(page, "Brain Workspace");
  await createSpaceAndList(page, "Creative", "Campaigns");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Design launch banner");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Design launch banner" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Design launch banner");

  await page.getByRole("button", { name: "Ask Brain about this task" }).click();
  const brainPanel = page.getByTestId("brain-chat-panel");
  await expect(brainPanel).toBeVisible();
  await expect(brainPanel.getByText("Brain — this task")).toBeVisible();

  const prompt = "What should the banner headline be?";
  await brainPanel.getByTestId("brain-message-input").fill(prompt);
  await brainPanel.getByRole("button", { name: "Send" }).click();

  // Mock client echoes: You said: "<prompt>". This is a placeholder reply…
  await expect(brainPanel.getByText(prompt, { exact: true }).first()).toBeVisible();
  await expect(brainPanel.getByText(`You said: "${prompt}"`, { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // Close Brain + task, reload, reopen — messages must still be there
  await brainPanel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(brainPanel).toBeHidden();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.reload();
  // List is the default view after reload — switch to Board so the task
  // title is a button that opens the detail panel (not an inline editor).
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Design launch banner" }).click();
  await expect(page.getByLabel("Task title")).toHaveValue("Design launch banner");
  await page.getByRole("button", { name: "Ask Brain about this task" }).click();
  const reopened = page.getByTestId("brain-chat-panel");
  // Reopening after a full page reload re-runs getOrCreate (a mutation)
  // before the messages.list query even starts — two serialized round
  // trips, same as the streaming-reply checks below, so it needs the same
  // generous timeout rather than Playwright's 5s default.
  await expect(reopened.getByText(prompt, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(reopened.getByText(`You said: "${prompt}"`, { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  await reopened.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Global Brain from the workspace shell
  await page.getByRole("button", { name: "Open Brain" }).click();
  const globalBrain = page.getByTestId("brain-chat-panel");
  await expect(globalBrain.getByRole("heading", { name: "Brain", exact: true })).toBeVisible();
  await globalBrain.getByTestId("brain-message-input").fill("Hello globally");
  await globalBrain.getByRole("button", { name: "Send" }).click();
  await expect(globalBrain.getByText('You said: "Hello globally"', { exact: false })).toBeVisible({
    timeout: 20_000,
  });
});
