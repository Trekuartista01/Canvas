import { db, schema } from "@canvas/db";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createSpaceAndList, createWorkspaceAndOpen, logIn, signUp, uniqueEmail } from "./helpers";

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

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

test("M7.8: Employee of the Month from last month's tasks (test hook), banner + admin ranking, live engagements board", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  await signUp(page, "Mira Manager");
  await createWorkspaceAndOpen(page, "Performance Workspace");
  const workspaceId = page.url().match(/\/w\/([^/]+)/)![1]!;
  const samEmail = await addStaff(page, "Sam Staff");
  await addStaff(page, "Tina Other");
  await createSpaceAndList(page, "Ops", "Field work");

  // Seed tasks straight into the DB: last month's history can't be made
  // through the UI (completedAt is always "now").
  const [{ list }] = (await db
    .select({ list: schema.lists })
    .from(schema.lists)
    .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
    .where(
      and(eq(schema.spaces.workspaceId, workspaceId), eq(schema.lists.name, "Field work")),
    )) as [{ list: typeof schema.lists.$inferSelect }];
  const statuses = await db
    .select()
    .from(schema.statuses)
    .where(eq(schema.statuses.listId, list.id));
  const statusOf = (kind: string) => statuses.find((s) => s.kind === kind)!.id;
  const userId = async (name: string) =>
    (
      await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
        .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.users.name, name)))
    )[0]!.id;
  const [sam, tina, mira] = [
    await userId("Sam Staff"),
    await userId("Tina Other"),
    await userId("Mira Manager"),
  ];

  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = ymd(lastMonth).slice(0, 7);
  const day = (d: number, hour = 10) => new Date(`${month}-${pad(d)}T${pad(hour)}:00:00Z`);
  let order = 0;
  async function seed(
    assignee: string,
    t: Partial<typeof schema.tasks.$inferInsert> & { title: string },
  ) {
    const [row] = await db
      .insert(schema.tasks)
      .values({
        listId: list.id,
        statusId: statusOf("open"),
        orderKey: `a${pad(order++)}`,
        createdBy: mira,
        createdAt: day(2),
        ...t,
      })
      .returning();
    await db.insert(schema.taskAssignees).values({ taskId: row!.id, userId: assignee });
    return row!;
  }
  // Sam: 3 on time → score 6. Tina: 4 late → score 4.
  for (const i of [1, 2, 3]) {
    await seed(sam, {
      title: `Sam on time ${i}`,
      dueDate: `${month}-15`,
      completedAt: day(10 + i),
      statusId: statusOf("done"),
    });
  }
  for (const i of [1, 2, 3, 4]) {
    await seed(tina, {
      title: `Tina late ${i}`,
      dueDate: `${month}-05`,
      completedAt: day(10 + i),
      statusId: statusOf("done"),
    });
  }

  // Run the monthly job for this workspace through the e2e test hook.
  const computed = await page.request.post("/test-hooks/employee-of-month", {
    data: { workspaceId, month },
  });
  expect(computed.ok()).toBe(true);
  expect(await computed.json()).toMatchObject({ userId: sam, score: 6 });

  // Days 1–5 of the following month: admins also see the ranking.
  await page.clock.setFixedTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 3, 10)));
  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByTestId("eom-banner")).toContainText("Sam Staff");
  const ranking = page.getByTestId("eom-ranking");
  await expect(ranking.locator("li").nth(0)).toContainText("Sam Staff");
  await expect(ranking.locator("li").nth(1)).toContainText("Tina Other");
  await expect(ranking.locator("li").nth(1)).toContainText("4 late");

  // Performance report for last month agrees.
  await page.getByRole("link", { name: "Performance" }).click();
  await page.getByRole("button", { name: "Last month" }).click();
  await expect(page.getByTestId("performance-row-Sam Staff")).toContainText(
    /Sam Staff\s*3\s*3\s*0\s*0/,
  );
  await expect(page.getByTestId("performance-row-Tina Other")).toContainText(
    /Tina Other\s*4\s*0\s*4/,
  );

  // Staff see the banner (on My Tasks, where they land) but not the ranking.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await staff.clock.setFixedTime(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 3, 10)),
  );
  await logIn(staff, samEmail, PASSWORD);
  await staff.getByRole("link", { name: "Open" }).click();
  await expect(staff.getByTestId("my-tasks-page")).toBeVisible();
  await expect(staff.getByTestId("eom-banner")).toContainText("Sam Staff");
  await expect(staff.getByTestId("eom-ranking")).toHaveCount(0);
  await staffContext.close();

  // Engagements: Tina has something in progress and overdue, Sam is on track.
  await page.clock.resume();
  const yesterday = ymd(new Date(Date.now() - 2 * 86_400_000));
  const nextWeek = ymd(new Date(Date.now() + 7 * 86_400_000));
  await seed(tina, {
    title: "Restock the shelves",
    dueDate: yesterday,
    statusId: statusOf("active"),
    createdAt: new Date(),
  });
  await seed(sam, {
    title: "Visit the new store",
    dueDate: nextWeek,
    statusId: statusOf("active"),
    createdAt: new Date(),
  });
  await page.getByRole("link", { name: "Engagements" }).click();
  const tinaCard = page.getByTestId("engagement-Tina Other");
  await expect(tinaCard.getByTestId("engagement-status")).toHaveText("Overdue");
  await expect(tinaCard).toContainText("Restock the shelves");
  await expect(
    page.getByTestId("engagement-Sam Staff").getByTestId("engagement-status"),
  ).toHaveText("On track");

  // Moving Tina's deadline in another tab updates the board live (WS invalidation).
  const other = await page.context().newPage();
  await other.goto(`/w/${workspaceId}`);
  await other.getByRole("link", { name: "Field work" }).click();
  await other.getByRole("button", { name: "Board", exact: true }).click();
  await other.getByRole("button", { name: "Restock the shelves" }).click();
  const dueSaved = other.waitForResponse((res) => res.url().includes("task.update"));
  await other.getByLabel("Due date").fill(nextWeek);
  expect((await dueSaved).ok()).toBe(true);
  await expect(tinaCard.getByTestId("engagement-status")).toHaveText("On track");
  await other.close();
});
