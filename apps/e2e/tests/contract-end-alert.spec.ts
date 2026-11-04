import { db, schema } from "@canvas/db";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createWorkspaceAndOpen, pageAs, seedMember, signUp, workspaceIdFrom } from "./helpers";

async function seedContract(workspaceId: string, userId: string, expiryDate: string) {
  const [row] = await db
    .insert(schema.employmentContracts)
    .values({
      workspaceId,
      userId,
      kind: "contract",
      title: `Contract ending ${expiryDate}`,
      startDate: "2026-01-01",
      expiryDate,
    })
    .returning({ id: schema.employmentContracts.id });
  return row!.id;
}

/** Who was notified about this contract's alert (one entry per notification). */
async function alerted(contractId: string) {
  const rows = await db
    .select({ userId: schema.notifications.userId })
    .from(schema.notifications)
    .innerJoin(schema.activity, eq(schema.activity.id, schema.notifications.activityId))
    .where(
      and(eq(schema.activity.entityId, contractId), eq(schema.activity.verb, "contract.expiring")),
    );
  return rows.map((r) => r.userId).sort();
}

async function runAlerts(page: Page, workspaceId: string, now: string) {
  const res = await page.request.post("/test-hooks/contract-end-alerts", {
    data: { workspaceId, now },
  });
  expect(res.ok()).toBe(true);
}

test("P8.6 contract-ending alert: every HR user, once, from 08:00 on the previous working day", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(90_000);

  await signUp(owner, "Olsi Owner");
  await createWorkspaceAndOpen(owner, "Contract Alerts Workspace");
  const ws = workspaceIdFrom(owner);
  const hana = await seedMember(ws, "Hana HR", "hr_finance");
  const hugo = await seedMember(ws, "Hugo HR", "hr_finance");
  const sam = await seedMember(ws, "Sam Staff", "employee");
  const arta = await seedMember(ws, "Arta Archived", "employee");
  const hrIds = [hana.userId, hugo.userId].sort();
  const hr = await pageAs(browser, hana, ws);

  // Ends Tue 15.12.2026, so the alert day is Mon 14.12.2026. Kosovo is UTC+1.
  const tuesday = await seedContract(ws, sam.userId, "2026-12-15");
  await runAlerts(owner, ws, "2026-12-13T12:00:00.000Z");
  await runAlerts(owner, ws, "2026-12-14T06:59:00.000Z");
  expect(await alerted(tuesday)).toEqual([]);

  await runAlerts(owner, ws, "2026-12-14T07:00:00.000Z");
  // HR only: not the owner, and not the employee.
  expect(await alerted(tuesday)).toEqual(hrIds);

  // HR, already in the app, gets the spec's sentence as a toast.
  const sentence =
    "Kontrata e Sam Staff përfundon më 15.12.2026. / Sam Staff's contract ends on 15.12.2026.";
  const toast = hr.getByTestId("notification-toast");
  await expect(toast).toContainText(sentence);
  await toast.getByRole("button").first().click();
  await expect(hr).toHaveURL(new RegExp(`/contracts\\?person=${sam.userId}`));
  await expect(hr.getByTestId("contract-detail-Sam Staff")).toBeVisible();

  // A second run sends nothing.
  await runAlerts(owner, ws, "2026-12-14T09:00:00.000Z");
  expect(await alerted(tuesday)).toEqual(hrIds);

  // Changing the end date re-arms it.
  const changed = await hr.request.post("/trpc/contract.update", {
    data: { contractId: tuesday, expiryDate: "2026-12-16" },
  });
  expect(changed.ok()).toBe(true);
  await runAlerts(owner, ws, "2026-12-15T07:00:00.000Z");
  expect(await alerted(tuesday)).toEqual([...hrIds, ...hrIds].sort());

  // Ends Mon 04.01.2027: the weekend and 1 January are skipped, so Thu 31.12.2026.
  const newYear = await seedContract(ws, sam.userId, "2027-01-04");
  await runAlerts(owner, ws, "2026-12-30T12:00:00.000Z");
  expect(await alerted(newYear)).toEqual([]);
  await runAlerts(owner, ws, "2026-12-31T07:00:00.000Z");
  expect(await alerted(newYear)).toEqual(hrIds);

  // Catching up: alert day Fri 18.12 missed, the Saturday run still sends it.
  const missed = await seedContract(ws, sam.userId, "2026-12-21");
  await runAlerts(owner, ws, "2026-12-19T07:00:00.000Z");
  expect(await alerted(missed)).toEqual(hrIds);

  // A contract that has already ended is not alerted late.
  const ended = await seedContract(ws, sam.userId, "2026-12-22");
  await runAlerts(owner, ws, "2026-12-22T07:00:00.000Z");
  expect(await alerted(ended)).toEqual([]);

  // An archived person gets no alert.
  const [membership] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, ws), eq(schema.memberships.userId, arta.userId)));
  await db.insert(schema.employeeProfiles).values({
    membershipId: membership!.id,
    status: "inactive",
    deactivatedAt: new Date(),
    archivedAt: new Date(),
  });
  const archived = await seedContract(ws, arta.userId, "2026-12-15");
  await runAlerts(owner, ws, "2026-12-14T07:00:00.000Z");
  expect(await alerted(archived)).toEqual([]);
});
