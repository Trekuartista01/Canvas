import { db, schema } from "@canvas/db";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createWorkspaceAndOpen, pageAs, seedMember, signUp, workspaceIdFrom } from "./helpers";

test("annual leave by time at the company: HR's rule applies, a person's own number still wins", async ({
  page: owner,
  browser,
}) => {
  await signUp(owner, "Olsi Owner");
  await createWorkspaceAndOpen(owner, "Tenure Workspace");
  const ws = workspaceIdFrom(owner);
  const hana = await seedMember(ws, "Hana HR", "hr_finance");
  const vera = await seedMember(ws, "Vera Veteran", "employee");
  await seedMember(ws, "Nora Nodate", "employee");

  const [membership] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, ws), eq(schema.memberships.userId, vera.userId)));
  await db
    .insert(schema.employeeProfiles)
    .values({ membershipId: membership!.id, employmentStartDate: "2015-03-01" });

  const hr = await pageAs(browser, hana, ws);
  await hr.goto(`/w/${ws}/leave-approvals?tab=balances`);
  const veraDays = hr.getByLabel("Entitlement for Vera Veteran");
  const noraDays = hr.getByLabel("Entitlement for Nora Nodate");
  await expect(veraDays).toHaveAttribute("placeholder", "20");

  const rules = hr.getByTestId("tenure-rules");
  await rules.getByRole("button", { name: "Add rule" }).click();
  await rules.getByLabel("Rule 1 years").fill("5");
  await rules.getByLabel("Rule 1 days").fill("25");
  const saved = hr.waitForResponse((res) => res.url().includes("setVacationTenureRules"));
  await rules.getByTestId("tenure-rules-save").click();
  expect((await saved).ok()).toBe(true);

  await expect(veraDays).toHaveAttribute("placeholder", "25");
  await expect(noraDays).toHaveAttribute("placeholder", "20");

  // The rule is what the person's own balance is built on, after a reload too.
  await hr.reload();
  await expect(rules.getByLabel("Rule 1 days")).toHaveValue("25");
  await expect(veraDays).toHaveAttribute("placeholder", "25");

  await veraDays.fill("30");
  const own = hr.waitForResponse((res) => res.url().includes("setBalance"));
  await veraDays.blur();
  expect((await own).ok()).toBe(true);
  await expect(veraDays).toHaveValue("30");
  const [balance] = await db
    .select({ entitlementDays: schema.leaveBalances.entitlementDays })
    .from(schema.leaveBalances)
    .where(eq(schema.leaveBalances.userId, vera.userId));
  expect(balance?.entitlementDays).toBe(30);
});
