import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, signUp } from "./helpers";

test("M5.1 automations: status → Done runs a tag + comment action, gated by a priority condition, and logs a run", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signUp(page, "Automation Owner");
  await createWorkspaceAndOpen(page, "Automation Workspace");
  await createSpaceAndList(page, "Support", "Bugs");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");

  // A throwaway task purely to originate the "shipped" tag (tag creation is
  // only exposed via a task's "+ New tag" flow) — the real task under test
  // starts with no tags, so the automation adding one is observable.
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Tag seed");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Tag seed" }).click();
  await page.getByRole("button", { name: "+ New tag" }).click();
  await page.getByLabel("New tag name").fill("shipped");
  const tagCreated = page.waitForResponse((res) => res.url().includes("tag.create"));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await tagCreated;
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Fix the login bug");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Fix the login bug" }).click();
  const panel = page.getByTestId("task-detail-panel");
  await expect(panel.getByLabel("Task title")).toHaveValue("Fix the login bug");
  await panel.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Build the automation: status -> Done, only if priority is high, then
  // add the "shipped" tag and post a comment.
  await page.getByRole("link", { name: "Automations", exact: true }).click();
  await expect(page.getByTestId("automations-list-page")).toBeVisible();
  await page.getByTestId("automations-new").click();
  await page.getByTestId("automations-new-name").fill("Ship tag on Done");
  await expect(page.getByTestId("automations-trigger-status-kind")).toBeVisible();

  await page.getByTestId("automations-condition-enabled").check();
  await page.getByTestId("automations-condition-priority").selectOption("high");

  await page.getByTestId("automation-action-type-0").selectOption("add_tag");
  const tagSelect = page.getByTestId("automation-action-tag-0");
  await expect(tagSelect).toContainText("shipped");
  await tagSelect.selectOption({ label: "shipped" });
  await page.getByTestId("automation-add-action").click();
  await page.getByTestId("automation-action-type-1").selectOption("post_comment");
  await page.getByTestId("automation-action-text-1").fill("Shipped via automation");

  const automationCreated = page.waitForResponse((res) => res.url().includes("automation.create"));
  await page.getByTestId("automations-create-submit").click();
  await automationCreated;
  await expect(page.getByTestId(/^automations-link-/)).toBeVisible();

  // Trigger it: move "Fix the login bug" to Done.
  await page.getByRole("link", { name: "Bugs" }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Fix the login bug" }).click();
  const updated = page.waitForResponse((res) => res.url().includes("task.update"));
  await panel.getByLabel("Status").selectOption({ label: "Completed" });
  await updated;

  // The automation's tag/comment are written server-side by the time
  // task.update resolves, but comments have no realtime invalidation of
  // their own (a pre-existing gap outside this milestone) — reload so the
  // panel's queries refetch fresh rather than relying on WS timing.
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Fix the login bug" }).click();
  // Not getByText("shipped") — that's a case-insensitive substring match
  // and also hits "Shipped via automation" below once both actions have
  // landed. The tag pill's own remove button is the unambiguous check
  // already used elsewhere for tag presence (tags-and-custom-fields.spec.ts).
  await expect(panel.getByRole("button", { name: "Remove tag shipped" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(panel.getByText("Comments (1)")).toBeVisible();
  await expect(panel.getByText("Shipped via automation")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // The run log shows exactly what fired.
  await page.getByRole("link", { name: "Automations", exact: true }).click();
  await page.getByTestId(/^automations-link-/).click();
  await expect(page.getByTestId("automation-editor-page")).toBeVisible();
  const runsList = page.getByTestId("automation-runs-list");
  await expect(runsList).toBeVisible({ timeout: 10_000 });
  const run = runsList.locator('[data-testid^="automation-run-"]').first();
  await expect(run.getByText("success")).toBeVisible();
  await expect(run).toContainText("Added a tag");
  await expect(run).toContainText("Posted a comment");
});
