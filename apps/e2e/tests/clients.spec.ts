import { db, schema } from "@canvas/db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import {
  addToAllBoards,
  createWorkspaceAndOpen,
  pageAs,
  seedMember,
  signUp,
  workspaceIdFrom,
  type SeededMember,
} from "./helpers";

const IMAGE = fileURLToPath(new URL("../fixtures/test-image.png", import.meta.url));

function trpcGet(request: Page["request"], path: string, input: unknown) {
  return request.get(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
}

async function requestAs(browser: Browser, member: SeededMember) {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "canvas_session", value: member.sessionId, url: "http://localhost:5183" },
  ]);
  return context.request;
}

async function addCard(page: Page, list: string, title: string) {
  const column = page.getByTestId(`board-list-${list}`);
  await column.getByRole("button", { name: "+ Add a card" }).click();
  await page.getByPlaceholder("Task title").fill(title);
  await page.keyboard.press("Enter");
  await expect(column.getByTestId(`board-card-${title}`)).toBeVisible();
}

async function openCard(page: Page, title: string) {
  await page.getByTestId(`board-card-${title}`).getByRole("button", { name: title }).click();
  await expect(page.getByTestId("card-client")).toBeVisible();
}

async function closeCard(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("card-client")).toHaveCount(0);
}

test("P8.10 clients: a card's name finds its client, the folder shows it, Ops, CEOs and Admin only", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(150_000);

  await signUp(owner, "Admin Owner");
  await createWorkspaceAndOpen(owner, "Clients Workspace");
  const ws = workspaceIdFrom(owner);
  const ops = await seedMember(ws, "Otto Ops", "operations_manager");
  const ceo = await seedMember(ws, "Cora Ceo", "ceo");
  const hana = await seedMember(ws, "Hana HR", "hr_finance");
  const sam = await seedMember(ws, "Sam Staff", "employee");
  const page = await pageAs(browser, ops, ws);

  // A client with aliases.
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByTestId("client-add").click();
  const form = page.getByTestId("client-form");
  await form.getByLabel("Name", { exact: true }).fill("Zone Club");
  await form.getByLabel("Other names").fill("Zone, Zone Club Prishtina");
  await page.getByTestId("client-save").click();
  const folder = page.getByTestId("client-folder-Zone Club");
  await expect(folder.getByTestId("client-open-tasks")).toHaveText("0 open tasks");

  await page.getByTestId("client-add").click();
  await form.getByLabel("Name", { exact: true }).fill("Art House");
  await page.getByTestId("client-save").click();
  await expect(page.getByTestId("client-folder-Art House")).toBeVisible();

  // The same name twice is refused.
  await page.getByTestId("client-add").click();
  await form.getByLabel("Name", { exact: true }).fill("zone club");
  await page.getByTestId("client-save").click();
  await expect(form.getByRole("alert")).toContainText("already a client");
  await page.getByTestId("client-add").click();

  // The acceptance line: a new card "Zone – story posts" is linked by itself.
  await page.getByRole("link", { name: "Boards", exact: true }).click();
  await page.getByTestId("new-board").click();
  await page.getByPlaceholder("Board name").fill("Social");
  await page.keyboard.press("Enter");
  await addCard(page, "To Do", "Zone – story posts");
  await expect(page.getByTestId("board-card-Zone – story posts")).toContainText("Zone Club");
  await openCard(page, "Zone – story posts");
  await expect(page.getByTestId("card-client-chip")).toHaveText("Detected: Zone Club");
  await closeCard(page);

  // Word boundaries and diacritics.
  await addCard(page, "To Do", "Time zones chart");
  await expect(page.getByTestId("board-card-Time zones chart")).not.toContainText("Zone Club");
  await addCard(page, "To Do", "Postera për ZONË");
  await expect(page.getByTestId("board-card-Postera për ZONË")).toContainText("Zone Club");

  // Two clients: nothing is chosen, and both are offered.
  await addCard(page, "To Do", "Zone and Art House event");
  await expect(page.getByTestId("board-card-Zone and Art House event")).not.toContainText(
    "Zone Club",
  );
  await openCard(page, "Zone and Art House event");
  const suggestions = page.getByTestId("card-client-suggestions");
  await expect(suggestions).toContainText("Zone Club");
  await expect(suggestions).toContainText("Art House");
  await suggestions.getByRole("button", { name: "Art House" }).click();
  await expect(page.getByTestId("card-client-chip")).toHaveText("Art House");
  await closeCard(page);

  // A card's own text can pick the client up later, and lose it again.
  await addCard(page, "To Do", "Menu redesign");
  await expect(page.getByTestId("board-card-Menu redesign")).not.toContainText("Zone Club");
  const [menu] = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
    .where(and(eq(schema.tasks.title, "Menu redesign"), eq(schema.spaces.workspaceId, ws)));
  const rename = (title: string) =>
    page.request.post("/trpc/task.update", { data: { taskId: menu!.id, title } });
  const clientOf = async () =>
    (await db.query.tasks.findFirst({ where: eq(schema.tasks.id, menu!.id) }))?.clientId ?? null;
  expect((await rename("Menu redesign for Zone")).ok()).toBe(true);
  expect(await clientOf()).not.toBeNull();
  expect((await rename("Menu redesign")).ok()).toBe(true);
  expect(await clientOf()).toBeNull();

  // Once someone clears it by hand, later edits leave it alone.
  expect((await rename("Menu redesign for Zone")).ok()).toBe(true);
  const cleared = await page.request.post("/trpc/task.setClient", {
    data: { taskId: menu!.id, clientId: null },
  });
  expect(cleared.ok()).toBe(true);
  expect((await rename("Menu redesign for Zone Club")).ok()).toBe(true);
  expect(await clientOf()).toBeNull();

  // The searchable dropdown and "+ New client".
  await page.reload();
  await openCard(page, "Time zones chart");
  await page.getByTestId("card-client").getByRole("button", { name: "Choose" }).click();
  const picker = page.getByTestId("card-client-picker");
  await picker.getByLabel("Search clients").fill("Northwind");
  await picker.getByRole("button", { name: '+ New client "Northwind"' }).click();
  await expect(page.getByTestId("card-client-chip")).toHaveText("Northwind");
  await closeCard(page);

  // Filter the board by client.
  await page.getByLabel("Filter by client").selectOption({ label: "Northwind" });
  await expect(page.getByTestId("board-card-Time zones chart")).toBeVisible();
  await expect(page.getByTestId("board-card-Zone – story posts")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();

  // The folder: linked cards only, grouped, and each opens on its board.
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(folder.getByTestId("client-open-tasks")).toHaveText("2 open tasks");
  await folder.click();
  const tasks = page.getByTestId("client-tasks");
  await expect(tasks).toContainText("Social / To Do (2)");
  await expect(tasks).toContainText("Zone – story posts");
  await expect(tasks).toContainText("Postera për ZONË");
  await expect(tasks).not.toContainText("Time zones chart");
  await page.getByTestId("client-task-Zone – story posts").click();
  await expect(page).toHaveURL(/\/boards\?.*card=/);
  await expect(page.getByTestId("board-list-To Do")).toContainText("Zone – story posts");
  await page.goBack();

  // Edit: aliases, a logo, archive and restore.
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByTestId("client-edit-form");
  await edit.getByLabel("Other names").fill("Zone, ZC");
  await page.getByTestId("client-edit-save").click();
  await expect(page.getByTestId("client-folder-page")).toContainText("Also known as Zone, ZC");
  await page.getByRole("button", { name: "Edit" }).click();
  const logoSaved = page.waitForResponse((res) => res.url().includes("clients.update"));
  await edit.getByLabel("Client logo").setInputFiles(IMAGE);
  expect((await logoSaved).ok()).toBe(true);
  const logo = page.getByTestId("client-folder-page").locator("img").first();
  await expect
    .poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByTestId("client-archive").click();
  await expect(page.getByTestId("client-folder-page")).toContainText("Archived");
  await page.getByTestId("client-folder-page").getByRole("link", { name: "Clients" }).click();
  await expect(folder).toHaveCount(0);
  await page.getByLabel("Show archived").check();
  await folder.click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByTestId("client-archive").click();
  await expect(page.getByTestId("client-archive")).toHaveText("Archive client");

  // A CEO and the Admin get all of it, like the Operations Manager.
  const zone = (
    await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.workspaceId, ws), eq(schema.clients.name, "Zone Club")))
  )[0]!;
  const ceoPage = await pageAs(browser, ceo, ws);
  await ceoPage.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(ceoPage.getByTestId("client-folder-Zone Club")).toBeVisible();
  await owner.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(owner.getByTestId("client-folder-Zone Club")).toBeVisible();
  expect((await trpcGet(owner.request, "clients.folder", { clientId: zone.id })).ok()).toBe(true);

  // HR and employees: no nav, no page, 403 from every route.
  const samPage = await pageAs(browser, sam, ws);
  const hrPage = await pageAs(browser, hana, ws);
  for (const [role, who, member] of [
    ["employee", samPage, sam],
    ["hr", hrPage, hana],
  ] as const) {
    await expect(who.getByRole("link", { name: "Clients", exact: true }), role).toHaveCount(0);
    await who.goto(`/w/${ws}/clients`);
    await expect(who.getByTestId("no-access"), role).toBeVisible();
    const request = await requestAs(browser, member);
    const queries = [
      ["clients.list", { workspaceId: ws }],
      ["clients.options", { workspaceId: ws }],
      ["clients.folder", { clientId: zone.id }],
    ] as const;
    for (const [path, input] of queries) {
      expect((await trpcGet(request, path, input)).status(), `${role} ${path}`).toBe(403);
    }
    const mutations = [
      ["clients.create", { workspaceId: ws, name: "Sneaky" }],
      ["clients.update", { clientId: zone.id, name: "Sneaky" }],
      ["clients.setArchived", { clientId: zone.id, archived: true }],
      ["clients.presignLogo", { clientId: zone.id, fileName: "a.png", mime: "image/png" }],
    ] as const;
    for (const [path, data] of mutations) {
      expect((await request.post(`/trpc/${path}`, { data })).status(), `${role} ${path}`).toBe(403);
    }
  }

  // A board member sees the chip on a card they have, and can clear it or pick
  // from what the card mentions, but can't reach any other client.
  await addToAllBoards(ws, sam.userId);
  await samPage.goto(`/w/${ws}/boards`);
  await expect(samPage.getByTestId("board-card-Zone – story posts")).toContainText("Zone Club");
  await openCard(samPage, "Zone – story posts");
  await expect(samPage.getByTestId("card-client-chip")).toHaveText("Detected: Zone Club");
  await expect(
    samPage.getByTestId("card-client").getByRole("button", { name: "Change" }),
  ).toHaveCount(0);
  await closeCard(samPage);
  const [northwind] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.workspaceId, ws), eq(schema.clients.name, "Northwind")));
  const samRequest = await requestAs(browser, sam);
  const [storyPosts] = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
    .where(and(eq(schema.tasks.title, "Zone – story posts"), eq(schema.spaces.workspaceId, ws)));
  const elsewhere = await samRequest.post("/trpc/task.setClient", {
    data: { taskId: storyPosts!.id, clientId: northwind!.id },
  });
  expect(elsewhere.status()).toBe(403);
  const sameOne = await samRequest.post("/trpc/task.setClient", {
    data: { taskId: storyPosts!.id, clientId: zone.id },
  });
  expect(sameOne.ok()).toBe(true);
  const clearedBySam = await samRequest.post("/trpc/task.setClient", {
    data: { taskId: storyPosts!.id, clientId: null },
  });
  expect(clearedBySam.ok()).toBe(true);
});
