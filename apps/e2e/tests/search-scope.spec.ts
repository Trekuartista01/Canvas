import { db, schema } from "@canvas/db";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  addToAllBoards,
  createSpaceAndList,
  createWorkspaceAndOpen,
  pageAs,
  seedMember,
  signUp,
  workspaceIdFrom,
  type SeededMember,
} from "./helpers";

const CONTRACT_TITLE = "Kontrata e punës 2026";
const SALARY = 1234.5;

interface SearchBody {
  people: { userId: string; name: string; archived: boolean }[];
  tasks: { title: string }[];
  hr?: {
    contracts: { title: string; files: number }[];
    payroll: { userName: string }[];
    leave: { id: string }[];
    vendims: { id: string }[];
  };
}

async function search(request: APIRequestContext, workspaceId: string, query: string) {
  const res = await request.get(
    `/trpc/search.global?input=${encodeURIComponent(JSON.stringify({ workspaceId, query }))}`,
  );
  expect(res.ok()).toBe(true);
  const raw = await res.text();
  return { raw, body: (JSON.parse(raw) as { result: { data: SearchBody } }).result.data };
}

async function addTask(page: Page, title: string) {
  const column = page.getByTestId("status-column-Pending");
  await column.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("Task title").fill(title);
  await page.keyboard.press("Enter");
  await expect(column.getByText(title)).toBeVisible();
}

async function requestAs(browser: Browser, member: SeededMember) {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "canvas_session", value: member.sessionId, url: "http://localhost:5183" },
  ]);
  return context.request;
}

test("P8.8 Smart Search scopes (spec §9): HR finds HR records, nobody else gets them or a count of them", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(120_000);

  await signUp(owner, "Admin Owner");
  await createWorkspaceAndOpen(owner, "Search Scope Workspace");
  const ws = workspaceIdFrom(owner);
  const hana = await seedMember(ws, "Hana HR", "hr_finance");
  const ops = await seedMember(ws, "Otto Ops", "operations_manager");
  const ceo = await seedMember(ws, "Cora Ceo", "ceo");
  const sam = await seedMember(ws, "Sam Staff", "employee");
  const olsi = await seedMember(ws, "Olsi Sopi", "employee");
  const gone = await seedMember(ws, "Arben Archived", "employee");

  // Tasks on a board that HR and the employees belong to.
  await createSpaceAndList(owner, "Marketing", "Campaigns");
  await owner.getByRole("button", { name: "Board", exact: true }).click();
  await addTask(owner, "Olsi Sopi onboarding checklist");
  await addTask(owner, "Zone Club launch poster");
  for (const member of [hana, sam, olsi]) await addToAllBoards(ws, member.userId);

  // Olsi's HR records.
  const [contract] = await db
    .insert(schema.employmentContracts)
    .values({
      workspaceId: ws,
      userId: olsi.userId,
      kind: "contract",
      title: CONTRACT_TITLE,
      startDate: "2026-01-01",
    })
    .returning({ id: schema.employmentContracts.id });
  await db
    .insert(schema.payrollRecords)
    .values({ workspaceId: ws, userId: olsi.userId, netSalaryEur: SALARY });
  const [leave] = await db
    .insert(schema.leaveRequests)
    .values({
      workspaceId: ws,
      userId: olsi.userId,
      type: "vacation",
      startDate: "2026-03-02",
      endDate: "2026-03-03",
      workingDays: 2,
      status: "approved",
      vendimPdfKey: `hr/vendim/${ws}/secret-key.pdf`,
    })
    .returning({ id: schema.leaveRequests.id });
  await db.insert(schema.leaveRequests).values({
    workspaceId: ws,
    userId: olsi.userId,
    type: "sick",
    startDate: "2026-04-01",
    endDate: "2026-04-01",
    workingDays: 1,
    status: "pending",
  });
  expect(contract && leave).toBeTruthy();

  // Arben is archived: gone from everyone's search but HR's.
  const [membership] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, ws), eq(schema.memberships.userId, gone.userId)));
  await db.insert(schema.employeeProfiles).values({
    membershipId: membership!.id,
    status: "inactive",
    deactivatedAt: new Date(),
    archivedAt: new Date(),
  });

  // Line 1: HR searches "Olsi Sopi" → directory card, contract files, payroll
  // entries, leave requests, Vendims.
  const hr = await search(await requestAs(browser, hana), ws, "Olsi Sopi");
  expect(hr.body.people.map((p) => p.name)).toEqual(["Olsi Sopi"]);
  expect(hr.body.tasks.map((t) => t.title)).toEqual(["Olsi Sopi onboarding checklist"]);
  expect(hr.body.hr?.contracts.map((c) => c.title)).toEqual([CONTRACT_TITLE]);
  expect(hr.body.hr?.payroll.map((p) => p.userName)).toEqual(["Olsi Sopi"]);
  expect(hr.body.hr?.leave).toHaveLength(2);
  expect(hr.body.hr?.vendims.map((v) => v.id)).toEqual([leave!.id]);
  // Even HR's search carries no amounts or storage keys.
  expect(hr.raw).not.toContain(String(SALARY));
  expect(hr.raw).not.toContain("secret-key");

  // HR's search is in the access log.
  const logged = await db
    .select({ action: schema.auditLog.action, payload: schema.auditLog.payloadJson })
    .from(schema.auditLog)
    .where(
      and(eq(schema.auditLog.workspaceId, ws), eq(schema.auditLog.action, "search.hr_results")),
    );
  expect(logged).toHaveLength(1);
  expect(logged[0]!.payload).toMatchObject({ query: "Olsi Sopi", contracts: 1, vendims: 1 });

  // Line 2: employee, Ops, CEO and Admin → directory card plus tasks they can
  // see. No HR key at all, so there's nothing to count.
  const others: [string, APIRequestContext][] = [
    ["employee", await requestAs(browser, sam)],
    ["ops", await requestAs(browser, ops)],
    ["ceo", await requestAs(browser, ceo)],
    ["admin", owner.request],
  ];
  for (const [role, request] of others) {
    const { body, raw } = await search(request, ws, "Olsi Sopi");
    expect(
      body.people.map((p) => p.name),
      role,
    ).toEqual(["Olsi Sopi"]);
    expect(
      body.tasks.map((t) => t.title),
      role,
    ).toEqual(["Olsi Sopi onboarding checklist"]);
    expect(Object.keys(body).sort(), role).toEqual(["people", "tasks"]);
    expect(raw, role).not.toContain(CONTRACT_TITLE);
    expect(raw, role).not.toContain("vendim");

    // A contract's own title finds nothing for them either.
    const byTitle = await search(request, ws, "Kontrata e punes");
    expect(byTitle.raw, role).not.toContain(CONTRACT_TITLE);
    expect(byTitle.body.people, role).toEqual([]);

    // An archived person isn't found.
    expect((await search(request, ws, "Arben Archived")).body.people, role).toEqual([]);
  }

  // Their searches aren't logged as HR reads.
  const stillOne = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(
      and(eq(schema.auditLog.workspaceId, ws), eq(schema.auditLog.action, "search.hr_results")),
    );
  expect(stillOne).toHaveLength(1);

  // HR does find archived people, marked as such, and ë/ç don't matter.
  const hrRequest = await requestAs(browser, hana);
  const archived = await search(hrRequest, ws, "arben");
  expect(archived.body.people.map((p) => [p.name, p.archived])).toEqual([["Arben Archived", true]]);
  expect((await search(hrRequest, ws, "kontrata e punes")).body.hr?.contracts).toHaveLength(1);

  // Line 3 (task half): "Zone" finds its tasks for Ops, CEO and Admin, who reach
  // every board. The Zone Club client folder joins this with P8.10.
  for (const [role, request] of others.filter(([r]) => r !== "employee")) {
    const { body } = await search(request, ws, "Zone");
    expect(
      body.tasks.map((t) => t.title),
      role,
    ).toEqual(["Zone Club launch poster"]);
  }

  // Line 4: an employee only gets tasks on boards they're a member of.
  const samRequest = await requestAs(browser, sam);
  expect((await search(samRequest, ws, "Zone")).body.tasks.map((t) => t.title)).toEqual([
    "Zone Club launch poster",
  ]);
  await db.delete(schema.spaceMembers).where(eq(schema.spaceMembers.userId, sam.userId));
  expect((await search(samRequest, ws, "Zone")).body.tasks).toEqual([]);
  await addToAllBoards(ws, sam.userId);

  // The page: HR sees the groups and its links work; an employee sees none.
  const hrPage = await pageAs(browser, hana, ws);
  await hrPage.getByRole("link", { name: "Smart Search", exact: true }).click();
  await hrPage.getByTestId("global-search-input").fill("Olsi Sopi");
  await hrPage.getByRole("button", { name: "Find", exact: true }).click();
  await expect(hrPage.getByTestId("global-search-people")).toContainText("Olsi Sopi");
  await expect(hrPage.getByTestId("global-search-tasks")).toContainText("onboarding checklist");
  await expect(hrPage.getByTestId("global-search-payroll")).toContainText("Olsi Sopi");
  await expect(hrPage.getByTestId("global-search-leave").locator("li")).toHaveCount(2);
  await expect(hrPage.getByTestId("global-search-vendims")).toContainText("02.03.2026");
  await expect(hrPage.getByTestId("global-search-contracts")).toContainText(CONTRACT_TITLE);

  await hrPage.getByTestId("global-search-payroll").getByRole("link").click();
  await expect(hrPage).toHaveURL(new RegExp(`/payroll\\?person=${olsi.userId}`));
  await expect(hrPage.getByTestId("payroll-drawer")).toContainText("Olsi Sopi");

  const staffPage = await pageAs(browser, sam, ws);
  await staffPage.getByRole("link", { name: "Smart Search", exact: true }).click();
  await staffPage.getByTestId("global-search-input").fill("Olsi Sopi");
  await staffPage.getByRole("button", { name: "Find", exact: true }).click();
  await expect(staffPage.getByTestId("global-search-people")).toContainText("Olsi Sopi");
  await expect(staffPage.getByTestId("global-search-tasks")).toBeVisible();
  for (const group of ["contracts", "payroll", "leave", "vendims"]) {
    await expect(staffPage.getByTestId(`global-search-${group}`)).toHaveCount(0);
  }
});
