import { db, schema } from "@canvas/db";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createWorkspaceAndOpen, pageAs, seedMember, signUp, workspaceIdFrom } from "./helpers";

async function requestLeave(page: Page, from: string, to: string) {
  await page.getByRole("link", { name: "Leave", exact: true }).click();
  const form = page.getByTestId("leave-form");
  await form.getByLabel("Type").selectOption("vacation");
  await form.getByLabel("First day").fill(from);
  await form.getByLabel("Last day").fill(to);
  return form;
}

async function submit(page: Page) {
  const sent = page.waitForResponse((res) => res.url().includes("leave.request"));
  await page.getByTestId("leave-submit").click();
  expect((await sent).ok()).toBe(true);
}

test("P8.4 leave: cross-year request → HR toast → per-year balances → reject with reason, over-balance warning, HR's own leave", async ({
  page: owner,
  browser,
}) => {
  test.setTimeout(150_000);

  await signUp(owner, "Olsi Owner");
  await createWorkspaceAndOpen(owner, "Approvals Workspace");
  const ws = workspaceIdFrom(owner);
  const hana = await seedMember(ws, "Hana HR", "hr_finance");
  const hugo = await seedMember(ws, "Hugo HR", "hr_finance");
  const sam = await seedMember(ws, "Sam Staff", "employee");
  const hr = await pageAs(browser, hana, ws);
  const staff = await pageAs(browser, sam, ws);

  // Sam asks for 30.12.2026 – 05.01.2027: 3 working days with Monday
  // substitution on (1 Jan holiday, Mon 4 Jan substitute), split 2 + 1.
  const form = await requestLeave(staff, "2026-12-30", "2027-01-05");
  await expect(staff.getByTestId("leave-preview")).toContainText("3 working days");
  await expect(staff.getByTestId("leave-preview-holidays")).toContainText(
    "are official holidays and are not counted",
  );
  await expect(staff.getByTestId("leave-preview-remaining")).toContainText(
    "Remaining after this: 2026: 18 days, 2027: 19 days",
  );
  await expect(form.getByRole("status")).toHaveCount(0);
  await submit(staff);

  // HR, already on Home, gets a toast live (WS invalidation, no reload) with
  // the spec's sentence; clicking opens the request.
  const toast = hr.getByTestId("notification-toast");
  await expect(toast).toContainText(
    "Sam Staff has requested annual leave from 30.12.2026 until 05.01.2027 (3 working days).",
  );
  await toast.getByRole("button").first().click();
  await expect(hr).toHaveURL(/leave-approvals\?request=/);
  await expect(hr.getByTestId("leave-pending-count")).toHaveText("1");
  const card = hr.getByTestId("leave-approval-Sam Staff");
  await expect(card.getByTestId("leave-approval-balance-2026")).toContainText("20 → 18 of 20");
  await expect(card.getByTestId("leave-approval-balance-2027")).toContainText("20 → 19 of 20");
  await expect(card.getByTestId("leave-approval-holidays")).toContainText("01.01.2027");

  // Rejecting needs a reason; Sam hears it.
  await card.getByTestId("leave-reject").click();
  await expect(card.getByTestId("leave-reject-confirm")).toBeDisabled();
  await card.getByLabel("Reason for rejecting").fill("Year-end close");
  const rejected = hr.waitForResponse((res) => res.url().includes("leave.decide"));
  await card.getByTestId("leave-reject-confirm").click();
  expect((await rejected).ok()).toBe(true);
  await hr.getByRole("tab", { name: "Rejected" }).click();
  await expect(hr.getByTestId("leave-approval-Sam Staff")).toContainText("Year-end close");
  await staff.reload();
  await staff.getByLabel("Notifications").click();
  await expect(staff.getByText("was not approved. Reason: Year-end close")).toBeVisible();
  await staff.keyboard.press("Escape");

  // Over the balance: a warning, not a block. HR approves anyway.
  await requestLeave(staff, "2027-02-01", "2027-03-31");
  await expect(staff.getByTestId("leave-warning")).toContainText(
    "Goes over the annual leave balance",
  );
  await expect(staff.getByTestId("leave-submit")).toBeEnabled();
  await submit(staff);
  await hr.goto(`/w/${ws}/leave-approvals`);
  const big = hr.getByTestId("leave-approval-Sam Staff");
  await expect(big.getByTestId("leave-approval-balance-2027")).toContainText("→ -");
  const approved = hr.waitForResponse((res) => res.url().includes("leave.decide"));
  await big.getByTestId("leave-approve").click();
  expect((await approved).ok()).toBe(true);
  await staff.reload();
  await staff.getByLabel("Notifications").click();
  await expect(
    staff.getByText("has been approved. You are expected back at work on 01.04.2027."),
  ).toBeVisible();

  // HR's own request: another HR user decides it.
  await requestLeave(hr, "2027-06-07", "2027-06-08");
  await submit(hr);
  await hr.goto(`/w/${ws}/leave-approvals`);
  const own = hr.getByTestId("leave-approval-Hana HR");
  await expect(own).toContainText("Your request");
  await expect(own).toContainText("Another HR user has to decide this one.");
  await expect(own.getByTestId("leave-approve")).toHaveCount(0);
  const [ownRow] = await db
    .select({ id: schema.leaveRequests.id })
    .from(schema.leaveRequests)
    .where(
      and(eq(schema.leaveRequests.workspaceId, ws), eq(schema.leaveRequests.userId, hana.userId)),
    );
  const selfTry = await hr.request.post("/trpc/leave.decide", {
    data: { leaveRequestId: ownRow!.id, decision: "approved" },
  });
  expect(selfTry.status()).toBe(403);
  const hugoPage = await pageAs(browser, hugo, ws);
  await hugoPage.goto(`/w/${ws}/leave-approvals`);
  const hugoDecides = hugoPage.waitForResponse((res) => res.url().includes("leave.decide"));
  await hugoPage.getByTestId("leave-approval-Hana HR").getByTestId("leave-approve").click();
  expect((await hugoDecides).ok()).toBe(true);

  // Alone in HR, Hana may approve her own leave — flagged self-approved.
  await db
    .update(schema.memberships)
    .set({ peopleRole: "employee" })
    .where(and(eq(schema.memberships.workspaceId, ws), eq(schema.memberships.userId, hugo.userId)));
  await requestLeave(hr, "2027-07-05", "2027-07-05");
  await submit(hr);
  await hr.goto(`/w/${ws}/leave-approvals`);
  const alone = hr.getByTestId("leave-approval-Hana HR");
  const selfApproved = hr.waitForResponse((res) => res.url().includes("leave.decide"));
  await alone.getByRole("button", { name: "Approve (self-approval)" }).click();
  expect((await selfApproved).ok()).toBe(true);
  await hr.getByRole("tab", { name: "Approved" }).click();
  await expect(
    hr.getByTestId("leave-approval-Hana HR").filter({ hasText: "Self-approved" }),
  ).toHaveCount(1);
  const audit = await db
    .select({ action: schema.auditLog.action })
    .from(schema.auditLog)
    .where(
      and(eq(schema.auditLog.workspaceId, ws), eq(schema.auditLog.action, "leave.self_approved")),
    );
  expect(audit).toHaveLength(1);

  // The Calendar tab shows who's off.
  await hr.getByRole("tab", { name: "Calendar" }).click();
  await expect(hr.getByTestId("approvals-calendar-month")).toBeVisible();

  for (const p of [hr, staff, hugoPage]) await p.context().close();
});
