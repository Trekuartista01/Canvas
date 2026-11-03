import { db, schema } from "@canvas/db";
import { todayReportDate } from "@canvas/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { decryptPayrollField, encryptPayrollField } from "./payroll";
import { findBalanceRow, getVacationBalance, loadLeaveRequests } from "./leave";
import { deleteObject } from "./storage";

/**
 * P8.3: everything on HR's Confidential tab for one person (spec §5) —
 * personal number (decrypted), pay currency, contract terms, salary and
 * bank details, and the annual leave allowance per year. Callers must have
 * checked HR access; this never filters.
 */
export async function loadConfidential(workspaceId: string, userId: string, membershipId: string) {
  const [profile, payroll, requests] = await Promise.all([
    db.query.employeeProfiles.findFirst({
      where: eq(schema.employeeProfiles.membershipId, membershipId),
    }),
    db.query.payrollRecords.findFirst({
      where: and(
        eq(schema.payrollRecords.workspaceId, workspaceId),
        eq(schema.payrollRecords.userId, userId),
      ),
    }),
    loadLeaveRequests(workspaceId, userId),
  ]);

  // This year, next year, and every year that has a stored allowance or leave.
  const thisYear = Number(todayReportDate(new Date()).slice(0, 4));
  const stored = await db
    .select({ year: schema.leaveBalances.year })
    .from(schema.leaveBalances)
    .where(
      and(
        eq(schema.leaveBalances.workspaceId, workspaceId),
        eq(schema.leaveBalances.userId, userId),
      ),
    );
  const years = [
    ...new Set([
      thisYear,
      thisYear + 1,
      ...stored.map((s) => s.year),
      ...requests.map((r) => Number(r.startDate.slice(0, 4))),
    ]),
  ].sort((a, b) => b - a);
  const allowances = await Promise.all(
    years.map(async (year) => {
      const row = await findBalanceRow(workspaceId, userId, year);
      return {
        year,
        entitlementOverride: row?.entitlementDays ?? null,
        carriedOverStored: row?.carriedOverDays ?? null,
        balance: await getVacationBalance(workspaceId, userId, year, requests),
      };
    }),
  );

  return {
    personalNumber: decryptPayrollField(
      workspaceId,
      userId,
      "personalNumber",
      profile?.personalNumberEnc ?? null,
    ),
    payCurrency: profile?.payCurrency ?? "EUR",
    contractType: profile?.contractType ?? null,
    contractStart: profile?.contractStart ?? null,
    contractEnd: profile?.contractEnd ?? null,
    grossSalary: payroll?.grossSalary ?? null,
    netSalary: payroll?.netSalaryEur ?? null,
    bankName: payroll?.bankName ?? null,
    accountHolder: payroll?.accountHolder ?? null,
    iban: decryptPayrollField(workspaceId, userId, "iban", payroll?.ibanEnc ?? null),
    idCardNumber: decryptPayrollField(
      workspaceId,
      userId,
      "idCardNumber",
      payroll?.idCardNumberEnc ?? null,
    ),
    allowances,
  };
}

export function encryptPersonalNumber(workspaceId: string, userId: string, value: string | null) {
  return value === null ? null : encryptPayrollField(workspaceId, userId, "personalNumber", value);
}

/**
 * P8.3 "permanently delete" (HR, archived people only): removes the person
 * from this workspace with their HR records — payroll, contracts, leave and
 * allowances — and the private files behind them. The account itself stays
 * (it may belong to other workspaces); tasks and comments they wrote stay,
 * like any other departed member's. Returns how many records went.
 */
export async function deletePersonRecords(
  workspaceId: string,
  userId: string,
  membershipId: string,
) {
  const fileKeys: string[] = [];
  const counts = await db.transaction(async (tx) => {
    const contracts = await tx
      .delete(schema.employmentContracts)
      .where(
        and(
          eq(schema.employmentContracts.workspaceId, workspaceId),
          eq(schema.employmentContracts.userId, userId),
        ),
      )
      .returning({ attachmentId: schema.employmentContracts.attachmentId });
    const leave = await tx
      .delete(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.workspaceId, workspaceId),
          eq(schema.leaveRequests.userId, userId),
        ),
      )
      .returning({ attachmentId: schema.leaveRequests.documentAttachmentId });
    const balances = await tx
      .delete(schema.leaveBalances)
      .where(
        and(
          eq(schema.leaveBalances.workspaceId, workspaceId),
          eq(schema.leaveBalances.userId, userId),
        ),
      )
      .returning({ id: schema.leaveBalances.id });
    const payroll = await tx
      .delete(schema.payrollRecords)
      .where(
        and(
          eq(schema.payrollRecords.workspaceId, workspaceId),
          eq(schema.payrollRecords.userId, userId),
        ),
      )
      .returning({ id: schema.payrollRecords.id });

    const attachmentIds = [...contracts, ...leave]
      .map((r) => r.attachmentId)
      .filter((id): id is string => id !== null);
    if (attachmentIds.length > 0) {
      const files = await tx
        .delete(schema.attachments)
        .where(
          and(inArray(schema.attachments.id, attachmentIds), isNotNull(schema.attachments.fileKey)),
        )
        .returning({ fileKey: schema.attachments.fileKey, thumbKey: schema.attachments.thumbKey });
      for (const f of files) {
        if (f.fileKey) fileKeys.push(f.fileKey);
        if (f.thumbKey) fileKeys.push(f.thumbKey);
      }
    }
    // The employee profile goes with the membership (ON DELETE CASCADE).
    await tx.delete(schema.memberships).where(eq(schema.memberships.id, membershipId));
    return {
      contracts: contracts.length,
      leaveRequests: leave.length,
      leaveBalances: balances.length,
      payroll: payroll.length,
    };
  });

  // After the commit: a storage hiccup must not resurrect the records.
  for (const key of fileKeys) {
    try {
      await deleteObject(key);
    } catch (err) {
      console.error(`[people] could not delete file ${key}:`, err);
    }
  }
  return counts;
}
