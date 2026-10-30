import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, inviteAndGetLink, signUp } from "./helpers";

test("search finds a task by title across the workspace", async ({ page }) => {
  await signUp(page, "Search Tester");
  await createWorkspaceAndOpen(page, "Search Workspace");
  await createSpaceAndList(page, "Ops", "Backlog");

  await page.getByRole("button", { name: "Board", exact: true }).click();
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Renew office lease");
  await page.keyboard.press("Enter");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Order new laptops");
  await page.keyboard.press("Enter");

  // scoped to the results dropdown — the board behind it also renders both
  // task titles as cards, so an unscoped text query would be ambiguous
  await page.getByLabel("Search tasks").fill("lease");
  const results = page.getByTestId("search-results");
  await expect(results.getByText("Renew office lease")).toBeVisible();
  await expect(results.getByText("Ops / Backlog")).toBeVisible();
  await expect(results.getByText("Order new laptops")).toHaveCount(0);

  await results.getByText("Renew office lease").click();
  await expect(page.getByLabel("Task title")).toHaveValue("Renew office lease");
});

test("task changes made by one user appear live for another user with no reload", async ({
  page,
  browser,
}) => {
  await signUp(page, "Ada Owner");
  await createWorkspaceAndOpen(page, "Realtime Workspace");

  // back to the dashboard to invite a teammate
  await page.getByRole("link", { name: "All workspaces" }).click();
  const bobEmail = `bob-realtime-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, bobEmail);

  // Bob signs up in a separate browser context — a real second user, not
  // just a second tab sharing Ada's session.
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signUp(bobPage, "Bob Member", bobEmail);
  await bobPage.goto(inviteLink);
  await bobPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(bobPage.getByText("Realtime Workspace", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Open" }).click();
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();

  // Bob navigates to the same board and just leaves it open — no reload or
  // re-navigation happens on Bob's side for the rest of this test, so any
  // update Bob sees below can only have arrived over the WS connection.
  await bobPage.getByRole("link", { name: "Open" }).click();
  await bobPage.getByRole("link", { name: "Sprint" }).click();
  await bobPage.getByRole("button", { name: "Board", exact: true }).click();

  // Ada creates a task
  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Live-updated task");
  await page.keyboard.press("Enter");

  await expect(bobPage.getByRole("button", { name: "Live-updated task" })).toBeVisible();

  // Ada moves it to "In Progress" from the detail panel — scoped to the
  // panel since "Status" is also a substring of each column's "Delete
  // status" button label
  await page.getByRole("button", { name: "Live-updated task" }).click();
  const panel = page.getByTestId("task-detail-panel");
  await panel.getByLabel("Status").selectOption({ label: "In progress" });

  const bobInProgressColumn = bobPage.getByTestId("status-column-In progress");
  await expect(bobInProgressColumn.getByText("Live-updated task")).toBeVisible();

  await bobContext.close();
});
