import { db, schema } from "@canvas/db";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createWorkspaceAndOpen, pageAs, seedMember, signUp, workspaceIdFrom } from "./helpers";

/** dnd-kit needs real pointer movement: press, travel in steps, release. */
async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 6);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

async function addCard(page: Page, list: string, title: string) {
  const column = page.getByTestId(`board-list-${list}`);
  await column.getByRole("button", { name: "+ Add a card" }).click();
  await page.getByPlaceholder("Task title").fill(title);
  await page.keyboard.press("Enter");
  await expect(column.getByTestId(`board-card-${title}`)).toBeVisible();
}

function trpcGet(request: Page["request"], path: string, input: unknown) {
  return request.get(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
}

test("P8.9 boards: switcher on top, default lists, cards drag and stay, lists managed, membership enforced", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(150_000);

  await signUp(owner, "Admin Owner");
  await createWorkspaceAndOpen(owner, "Boards Workspace");
  const ws = workspaceIdFrom(owner);
  const ops = await seedMember(ws, "Otto Ops", "operations_manager");
  const ceo = await seedMember(ws, "Cora Ceo", "ceo");
  const sam = await seedMember(ws, "Sam Staff", "employee");
  const tina = await seedMember(ws, "Tina Other", "employee");
  const page = await pageAs(browser, ops, ws);

  // The switcher is at the top of the page, not in the sidebar.
  await page.getByRole("link", { name: "Boards", exact: true }).click();
  await expect(page.getByTestId("board-switcher")).toBeVisible();
  await expect(page.getByRole("button", { name: "New space" })).toHaveCount(0);

  await page.getByTestId("new-board").click();
  await page.getByPlaceholder("Board name").fill("Zone Club");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Zone Club" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Default lists, in order.
  const lists = page.getByTestId("board-lists").locator("section");
  await expect(lists).toHaveCount(4);
  await expect(lists.locator("header a")).toHaveText(["To Do", "In Progress", "Review", "Done"]);

  // Quick-add, then drag between lists: it stays there after a reload.
  await addCard(page, "To Do", "Launch poster");
  await addCard(page, "To Do", "Story posts");
  await dragTo(
    page,
    page.getByTestId("board-card-Launch poster"),
    page.getByTestId("board-list-Review"),
  );
  await expect(
    page.getByTestId("board-list-Review").getByTestId("board-card-Launch poster"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByTestId("board-list-Review").getByTestId("board-card-Launch poster"),
  ).toBeVisible();
  await expect(page.getByTestId("board-list-To Do").getByTestId("board-list-count")).toHaveText(
    "1",
  );

  // The move kept its status kind: each list has its own statuses.
  const [moved] = await db
    .select({ kind: schema.statuses.kind, list: schema.lists.name })
    .from(schema.tasks)
    .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
    .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
    .where(and(eq(schema.tasks.title, "Launch poster"), eq(schema.spaces.workspaceId, ws)))
    .limit(1);
  expect(moved).toEqual({ kind: "open", list: "Review" });

  // Order within a list persists too.
  await addCard(page, "Review", "Second in review");
  await dragTo(
    page,
    page.getByTestId("board-card-Second in review"),
    page.getByTestId("board-card-Launch poster"),
  );
  await expect
    .poll(async () => page.getByTestId("board-list-Review").locator("article").allTextContents())
    .toEqual(["Second in review", "Launch poster"]);
  await page.reload();
  await expect(page.getByTestId("board-list-Review").locator("article")).toHaveText([
    "Second in review",
    "Launch poster",
  ]);

  // Lists: add, rename, reorder, archive, restore.
  await page.getByTestId("add-list").click();
  await page.getByPlaceholder("List name").fill("Ideas");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("board-list-Ideas")).toBeVisible();
  await page.getByRole("button", { name: "Rename Ideas" }).click();
  await page.getByPlaceholder("List name").fill("Backlog");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("board-list-Backlog")).toBeVisible();
  await page.getByRole("button", { name: "Move Backlog left" }).click();
  await expect(lists.locator("header a")).toHaveText([
    "To Do",
    "In Progress",
    "Review",
    "Backlog",
    "Done",
  ]);
  await page.getByRole("button", { name: "Archive Backlog" }).click();
  await expect(page.getByTestId("board-list-Backlog")).toHaveCount(0);
  await page.getByRole("button", { name: "Restore Backlog" }).click();
  await expect(page.getByTestId("board-list-Backlog")).toBeVisible();

  // Card front: overdue red, assignee, checklist, comment counts.
  const [card] = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
    .where(and(eq(schema.tasks.title, "Launch poster"), eq(schema.spaces.workspaceId, ws)))
    .limit(1);
  await db.update(schema.tasks).set({ dueDate: "2020-01-15" }).where(eq(schema.tasks.id, card!.id));
  const [checklist] = await db
    .insert(schema.checklists)
    .values({ taskId: card!.id, name: "Steps", orderKey: "a0" })
    .returning();
  await db.insert(schema.checklistItems).values([
    { checklistId: checklist!.id, text: "One", orderKey: "a0", done: true },
    { checklistId: checklist!.id, text: "Two", orderKey: "a1" },
  ]);

  await page.reload();
  await expect(
    page.getByTestId("board-card-Launch poster").getByTestId("card-due"),
  ).toHaveAttribute("data-overdue", "true");
  await expect(
    page.getByTestId("board-card-Launch poster").getByTestId("card-checklist"),
  ).toHaveText("1/2");

  // Filters narrow the cards.
  await page.getByLabel("Filter by due date").selectOption("overdue");
  await expect(page.getByTestId("board-card-Launch poster")).toBeVisible();
  await expect(page.getByTestId("board-card-Story posts")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("board-card-Story posts")).toBeVisible();

  // Sam isn't on the board: no tab, no card, no search hit, no direct access.
  const staff = await pageAs(browser, sam, ws);
  await staff.getByRole("link", { name: "Boards", exact: true }).click();
  await expect(staff.getByTestId("boards-empty")).toBeVisible();
  await expect(staff.getByTestId("new-board")).toHaveCount(0);
  const spaceId = (
    await db
      .select({ id: schema.spaces.id })
      .from(schema.spaces)
      .where(and(eq(schema.spaces.workspaceId, ws), eq(schema.spaces.name, "Zone Club")))
  )[0]!.id;
  expect((await trpcGet(staff.request, "task.board", { spaceId })).status()).toBe(403);
  expect((await trpcGet(staff.request, "task.get", { taskId: card!.id })).status()).toBe(403);
  expect((await trpcGet(staff.request, "comment.list", { taskId: card!.id })).status()).toBe(403);
  const searched = await trpcGet(staff.request, "search.global", {
    workspaceId: ws,
    query: "Launch poster",
  });
  expect((await searched.json()).result.data.tasks).toEqual([]);

  // Only board managers manage: Sam can't create or change boards and lists.
  const refused = [
    ["hierarchy.space.create", { workspaceId: ws, name: "Sam's board" }],
    ["hierarchy.space.update", { spaceId, name: "Renamed" }],
    ["hierarchy.space.delete", { spaceId }],
    ["hierarchy.list.create", { spaceId, name: "Sam's list" }],
    ["hierarchy.members.add", { spaceId, userId: sam.userId }],
  ] as const;
  for (const [path, data] of refused) {
    expect((await staff.request.post(`/trpc/${path}`, { data })).status(), path).toBe(403);
  }

  // Ops adds Sam from the Members panel; the board appears, and he can work.
  await page.getByTestId("board-members-open").click();
  const panel = page.getByTestId("board-members");
  await panel.getByLabel("Add a member").selectOption({ label: "Sam Staff" });
  await expect(panel.getByRole("button", { name: "Remove Sam Staff" })).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();

  await staff.reload();
  await expect(staff.getByRole("tab", { name: "Zone Club" })).toBeVisible();
  await expect(staff.getByTestId("new-board")).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Rename To Do" })).toHaveCount(0);
  await addCard(staff, "To Do", "Sam's card");
  await dragTo(
    staff,
    staff.getByTestId("board-card-Sam's card"),
    staff.getByTestId("board-list-Done"),
  );
  await expect(
    staff.getByTestId("board-list-Done").getByTestId("board-card-Sam's card"),
  ).toBeVisible();

  // Tina isn't on it. Assigning her a card tells her and puts her on the board.
  expect((await trpcGet(owner.request, "task.board", { spaceId })).ok()).toBe(true);
  const assigned = await page.request.post("/trpc/task.assignees.add", {
    data: { taskId: card!.id, userId: tina.userId },
  });
  expect(assigned.ok()).toBe(true);
  const tinaPage = await pageAs(browser, tina, ws);
  expect((await trpcGet(tinaPage.request, "task.get", { taskId: card!.id })).ok()).toBe(true);
  const told = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .innerJoin(schema.activity, eq(schema.activity.id, schema.notifications.activityId))
    .where(
      and(
        eq(schema.notifications.userId, tina.userId),
        eq(schema.activity.verb, "task.assigned"),
        eq(schema.activity.entityId, card!.id),
      ),
    );
  expect(told).toHaveLength(1);

  // Card detail: move to another list, then archive.
  await page
    .getByTestId("board-card-Story posts")
    .getByRole("button", { name: "Story posts" })
    .click();
  await expect(page).toHaveURL(/card=/);
  const movePanel = page.getByTestId("card-move");
  await movePanel.getByLabel("List").selectOption({ label: "In Progress" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("board-list-In Progress").getByTestId("board-card-Story posts"),
  ).toBeVisible();
  await page
    .getByTestId("board-card-Story posts")
    .getByRole("button", { name: "Story posts" })
    .click();
  await movePanel.getByRole("button", { name: "Archive card" }).click();
  await movePanel.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page.getByTestId("board-card-Story posts")).toHaveCount(0);

  // A CEO and the Admin reach the board without being members of it.
  const ceoPage = await pageAs(browser, ceo, ws);
  await ceoPage.getByRole("link", { name: "Boards", exact: true }).click();
  await expect(ceoPage.getByRole("tab", { name: "Zone Club" })).toBeVisible();
  await expect(ceoPage.getByTestId("new-board")).toBeVisible();
  await owner.getByRole("link", { name: "Boards", exact: true }).click();
  await expect(owner.getByRole("tab", { name: "Zone Club" })).toBeVisible();

  // Removing Sam takes the board away again.
  await page.getByTestId("board-members-open").click();
  await panel.getByRole("button", { name: "Remove Sam Staff" }).click();
  await expect(panel.getByRole("button", { name: "Remove Sam Staff" })).toHaveCount(0);
  expect((await trpcGet(staff.request, "task.board", { spaceId })).status()).toBe(403);
});
