import { db, schema } from "@canvas/db";
import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import {
  createWorkspaceAndOpen,
  seedMember,
  signUp,
  workspaceIdFrom,
  type SeededMember,
} from "./helpers";

/**
 * P8.1 (docs/hr-ops-spec.md §1): every HR route refuses everyone but HR —
 * admin and the workspace owner included (no admin bypass). Calls the API
 * directly with real ids, so a refusal is the permission check and not a
 * missing record.
 */
type Call =
  { kind: "query" | "mutation"; path: string; input: unknown } | { kind: "rest"; path: string };

async function call(request: APIRequestContext, c: Call) {
  if (c.kind === "rest") return request.get(c.path);
  if (c.kind === "query") {
    return request.get(`/trpc/${c.path}?input=${encodeURIComponent(JSON.stringify(c.input))}`);
  }
  return request.post(`/trpc/${c.path}`, { data: c.input });
}

async function requestAs(browser: Browser, member: SeededMember) {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "canvas_session", value: member.sessionId, url: "http://localhost:5183" },
  ]);
  return context;
}

test("HR routes: 403 for admin, owner, CEO, Operations Manager and employees; 200 for HR", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(120_000);

  await signUp(owner, "Olsi Owner");
  await createWorkspaceAndOpen(owner, "Guard Workspace");
  const ws = workspaceIdFrom(owner);

  const hr = await seedMember(ws, "Hana HR", "hr_finance");
  const sam = await seedMember(ws, "Sam Staff", "employee");
  const others = {
    admin: await seedMember(ws, "Ada Admin", "admin"),
    ceo: await seedMember(ws, "Cleo CEO", "ceo"),
    operations_manager: await seedMember(ws, "Otto Ops", "operations_manager"),
    employee: await seedMember(ws, "Erin Employee", "employee"),
  };

  // Real records to act on: Sam's pending + approved leave, his contract file.
  const [pending] = await db
    .insert(schema.leaveRequests)
    .values({
      workspaceId: ws,
      userId: sam.userId,
      type: "vacation",
      startDate: "2030-03-04",
      endDate: "2030-03-08",
      workingDays: 5,
      status: "pending",
    })
    .returning();
  const [approved] = await db
    .insert(schema.leaveRequests)
    .values({
      workspaceId: ws,
      userId: sam.userId,
      type: "vacation",
      startDate: "2030-04-01",
      endDate: "2030-04-02",
      workingDays: 2,
      status: "approved",
      decidedBy: hr.userId,
      decidedAt: new Date(),
    })
    .returning();
  const [file] = await db
    .insert(schema.attachments)
    .values({
      workspaceId: ws,
      uploaderId: hr.userId,
      fileKey: `contracts/${ws}/guard/contract.pdf`,
      fileName: "contract.pdf",
      mime: "application/pdf",
      sizeBytes: 10,
    })
    .returning();
  const [contract] = await db
    .insert(schema.employmentContracts)
    .values({
      workspaceId: ws,
      userId: sam.userId,
      kind: "contract",
      title: "Sam's contract",
      startDate: "2026-01-01",
      attachmentId: file!.id,
      uploadedBy: hr.userId,
    })
    .returning();
  const [holiday] = await db
    .select({ id: schema.publicHolidays.id })
    .from(schema.publicHolidays)
    .where(eq(schema.publicHolidays.workspaceId, ws))
    .limit(1);

  const userId = sam.userId;
  const HR_CALLS: Call[] = [
    { kind: "query", path: "payroll.list", input: { workspaceId: ws } },
    { kind: "query", path: "payroll.get", input: { workspaceId: ws, userId } },
    {
      kind: "mutation",
      path: "payroll.upsert",
      input: { workspaceId: ws, userId, netSalaryEur: 1 },
    },
    { kind: "query", path: "payroll.audit", input: { workspaceId: ws } },
    { kind: "query", path: "audit.list", input: { workspaceId: ws } },
    { kind: "rest", path: `/payroll-export/${ws}/payroll.xlsx` },
    { kind: "rest", path: `/payroll-export/${ws}/payroll.pdf` },
    { kind: "query", path: "contract.list", input: { workspaceId: ws } },
    { kind: "query", path: "contract.forPerson", input: { workspaceId: ws, userId } },
    {
      kind: "mutation",
      path: "contract.presignUpload",
      input: { workspaceId: ws, fileName: "c.pdf", mime: "application/pdf", sizeBytes: 10 },
    },
    {
      kind: "mutation",
      path: "contract.create",
      input: {
        workspaceId: ws,
        userId,
        kind: "contract",
        title: "Another",
        startDate: "2026-01-01",
        attachmentId: file!.id,
      },
    },
    { kind: "mutation", path: "contract.update", input: { contractId: contract!.id, title: "X" } },
    { kind: "mutation", path: "contract.downloadUrl", input: { contractId: contract!.id } },
    { kind: "rest", path: `/uploads/${file!.id}` },
    { kind: "mutation", path: "contract.delete", input: { contractId: contract!.id } },
    {
      kind: "mutation",
      path: "holiday.create",
      input: { workspaceId: ws, nameSq: "Ditë roje", nameEn: "Guard day", date: "2027-06-01" },
    },
    { kind: "mutation", path: "holiday.update", input: { holidayId: holiday!.id, nameEn: "X" } },
    { kind: "mutation", path: "holiday.delete", input: { holidayId: holiday!.id } },
    { kind: "mutation", path: "holiday.setNoticeDays", input: { workspaceId: ws, days: 3 } },
    {
      kind: "mutation",
      path: "holiday.setWeekendSubstitution",
      input: { workspaceId: ws, enabled: true },
    },
    { kind: "query", path: "leave.team", input: { workspaceId: ws } },
    { kind: "query", path: "leave.balances", input: { workspaceId: ws, year: 2030 } },
    {
      kind: "mutation",
      path: "leave.decide",
      input: { leaveRequestId: pending!.id, decision: "approved" },
    },
    {
      kind: "mutation",
      path: "leave.record",
      input: {
        workspaceId: ws,
        userId,
        type: "sick",
        startDate: "2030-05-06",
        endDate: "2030-05-06",
      },
    },
    {
      kind: "mutation",
      path: "leave.setBalance",
      input: { workspaceId: ws, userId, year: 2030, entitlementDays: 25 },
    },
    {
      kind: "mutation",
      path: "leave.setDefaultVacationDays",
      input: { workspaceId: ws, days: 21 },
    },
    { kind: "rest", path: `/leave-documents/${approved!.id}/confirmation.pdf` },
    {
      kind: "mutation",
      path: "people.createStaff",
      input: {
        workspaceId: ws,
        name: "Nobody",
        email: `guard-${Date.now()}@example.com`,
        password: "guard-pass-123",
      },
    },
    {
      kind: "mutation",
      path: "people.updateProfile",
      input: { workspaceId: ws, userId, phone: "1" },
    },
    {
      kind: "mutation",
      path: "people.setManager",
      input: { workspaceId: ws, userId, managerUserId: null },
    },
    { kind: "query", path: "people.directory", input: { workspaceId: ws, includeInactive: true } },
    // Last: deactivating Sam would change later answers.
    {
      kind: "mutation",
      path: "people.setStatus",
      input: { workspaceId: ws, userId, status: "inactive" },
    },
  ];

  const label = (c: Call) => c.path;
  const callers: [string, APIRequestContext][] = [["owner (admin)", owner.request]];
  const contexts = [];
  for (const [role, member] of Object.entries(others)) {
    const context = await requestAs(browser, member);
    contexts.push(context);
    callers.push([role, context.request]);
  }

  for (const [role, request] of callers) {
    for (const c of HR_CALLS) {
      const res = await call(request, c);
      expect(res.status(), `${role} → ${label(c)}`).toBe(403);
    }
  }

  // Directory roles see a profile, but never its confidential part.
  for (const [role, request] of callers.filter(([r]) => r !== "employee")) {
    const res = await call(request, {
      kind: "query",
      path: "people.profile",
      input: { workspaceId: ws, userId },
    });
    expect(res.status(), role).toBe(200);
    const body = (await res.json()) as { result: { data: { personal: unknown } } };
    expect(body.result.data.personal, role).toBeNull();
  }

  // Nothing above went through: Sam is untouched, nothing was approved or filed.
  const [samRow] = await db
    .select({ status: schema.employeeProfiles.status })
    .from(schema.employeeProfiles)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.employeeProfiles.membershipId))
    .where(and(eq(schema.memberships.workspaceId, ws), eq(schema.memberships.userId, userId)));
  expect(samRow?.status ?? "active").toBe("active");
  const stillPending = await db.query.leaveRequests.findFirst({
    where: eq(schema.leaveRequests.id, pending!.id),
  });
  expect(stillPending!.status).toBe("pending");

  // HR itself gets through (one read per area is enough here; the feature
  // specs cover HR's flows).
  const hrContext = await requestAs(browser, hr);
  contexts.push(hrContext);
  for (const c of HR_CALLS.filter((c) => c.kind === "query" || c.kind === "rest").slice(0, 6)) {
    const res = await call(hrContext.request, c);
    expect(res.status(), `hr → ${label(c)}`).toBe(200);
  }

  for (const context of contexts) await context.close();
});

test("RLS is on for every table, so Supabase's Data API can't read any of it", async () => {
  const rows = await db.execute<{ table: string }>(sql`
    select c.relname as table
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by 1
  `);
  expect(rows.rows.map((r) => r.table)).toEqual([]);
});
