import { expect, test } from "@playwright/test";
import { createSpaceAndList, createWorkspaceAndOpen, inviteAndGetLink, signUp } from "./helpers";

const API_ORIGIN = "http://localhost:3001";

test("Phase 6: data export downloads a workspace's tasks as CSV and as JSON", async ({ page }) => {
  await signUp(page, "Export Tester");
  await createWorkspaceAndOpen(page, "Export Workspace");
  await createSpaceAndList(page, "Ops", "Sprint");
  await page.getByRole("button", { name: "Board", exact: true }).click();

  const todoColumn = page.getByTestId("status-column-Pending");
  await todoColumn.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill("Ship the launch email");
  await page.keyboard.press("Enter");
  await expect(todoColumn.getByText("Ship the launch email")).toBeVisible();

  const workspaceId = new URL(page.url()).pathname.split("/")[2]!;

  await page.getByRole("link", { name: "Admin", exact: true }).click();
  const csvLink = page.getByTestId("export-tasks-csv");
  const jsonLink = page.getByTestId("export-workspace-json");
  await expect(csvLink).toHaveAttribute("href", `/export/${workspaceId}/tasks.csv`);
  await expect(jsonLink).toHaveAttribute("href", `/export/${workspaceId}/workspace.json`);

  // Fetch the real served bytes directly (same session cookie the page
  // itself uses) — a stronger check than a UI click that the actual export
  // content is correct, not just that a link with the right href exists.
  const csvResponse = await page.request.get(`${API_ORIGIN}/export/${workspaceId}/tasks.csv`);
  expect(csvResponse.ok()).toBe(true);
  expect(csvResponse.headers()["content-disposition"]).toContain("tasks-export.csv");
  const csvBody = await csvResponse.text();
  expect(csvBody.split("\r\n")[0]).toBe(
    "Name,Space,List,Status,Priority,Assignee Email,Tags,Start Date,Due Date,Completed At,Created At",
  );
  expect(csvBody).toContain("Ship the launch email,Ops,Sprint,Pending");

  const jsonResponse = await page.request.get(`${API_ORIGIN}/export/${workspaceId}/workspace.json`);
  expect(jsonResponse.ok()).toBe(true);
  expect(jsonResponse.headers()["content-disposition"]).toContain("workspace-export.json");
  const jsonBody = await jsonResponse.json();
  expect(jsonBody.workspace.name).toBe("Export Workspace");
  expect(jsonBody.tasks).toHaveLength(1);
  expect(jsonBody.tasks[0]).toMatchObject({
    title: "Ship the launch email",
    space: "Ops",
    list: "Sprint",
    status: "Pending",
  });
});

test("Phase 6: data export is forbidden for a guest", async ({ page, browser }) => {
  await signUp(page, "Owner Export");
  await createWorkspaceAndOpen(page, "Guarded Workspace");
  const workspaceId = new URL(page.url()).pathname.split("/")[2]!;

  await page.getByRole("link", { name: "All workspaces" }).click();
  const guestEmail = `guest-${Date.now()}@example.com`;
  const inviteLink = await inviteAndGetLink(page, guestEmail, "guest");

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await signUp(guestPage, "Guest Export", guestEmail);
  await guestPage.goto(inviteLink);
  await guestPage.getByRole("button", { name: /Accept & join/ }).click();
  await expect(guestPage.getByRole("link", { name: "Open" })).toBeVisible();

  const response = await guestPage.request.get(`${API_ORIGIN}/export/${workspaceId}/tasks.csv`);
  expect(response.status()).toBe(403);
});
