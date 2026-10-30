import { db, schema } from "@canvas/db";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { env } from "../env";
import { decryptField, encryptField, maskLast4 } from "./field-crypto";
import { activeMembershipCondition } from "./membership";

export type PayrollSecretField = "idCardNumber" | "iban";

/** Binds a ciphertext to its row and field (see field-crypto.ts). */
function context(workspaceId: string, userId: string, field: PayrollSecretField) {
  return `payroll:${workspaceId}:${userId}:${field}`;
}

export function encryptPayrollField(
  workspaceId: string,
  userId: string,
  field: PayrollSecretField,
  value: string,
) {
  return encryptField(value, env.PAYROLL_ENCRYPTION_KEY, context(workspaceId, userId, field));
}

/**
 * null if there's nothing stored. An undecryptable value (wrong key, edited
 * by hand) comes back as a marker rather than failing the whole table — and
 * the error never includes the stored value.
 */
export function decryptPayrollField(
  workspaceId: string,
  userId: string,
  field: PayrollSecretField,
  stored: string | null,
): string | null {
  if (!stored) return null;
  try {
    return decryptField(stored, env.PAYROLL_ENCRYPTION_KEY, context(workspaceId, userId, field));
  } catch {
    console.error(`[payroll] could not decrypt ${field} for user ${userId} in ${workspaceId}`);
    return "[unreadable]";
  }
}

export interface PayrollRow {
  userId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  recordId: string | null;
  netSalaryEur: number | null;
  bankName: string | null;
  accountHolder: string | null;
  /** Full value when revealed, "•••• 1234" otherwise. */
  idCardNumber: string | null;
  iban: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/**
 * Every active member with their payroll record (if any). `reveal` decrypts
 * the ID-card number and IBAN in full — only for the edit drawer and the
 * exports, which audit it; otherwise they're masked to the last 4.
 */
export async function loadPayrollRows(
  workspaceId: string,
  opts: { reveal: boolean; userId?: string },
): Promise<PayrollRow[]> {
  const updater = alias(schema.users, "updater");
  const rows = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      jobTitle: schema.employeeProfiles.jobTitle,
      record: schema.payrollRecords,
      updatedByName: updater.name,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(
      schema.employeeProfiles,
      eq(schema.employeeProfiles.membershipId, schema.memberships.id),
    )
    .leftJoin(
      schema.payrollRecords,
      and(
        eq(schema.payrollRecords.workspaceId, schema.memberships.workspaceId),
        eq(schema.payrollRecords.userId, schema.memberships.userId),
      ),
    )
    .leftJoin(updater, eq(updater.id, schema.payrollRecords.updatedBy))
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        activeMembershipCondition,
        opts.userId ? eq(schema.memberships.userId, opts.userId) : undefined,
      ),
    )
    .orderBy(asc(schema.users.name));

  return rows.map(({ record, ...r }) => {
    const idCard = decryptPayrollField(
      workspaceId,
      r.userId,
      "idCardNumber",
      record?.idCardNumberEnc ?? null,
    );
    const iban = decryptPayrollField(workspaceId, r.userId, "iban", record?.ibanEnc ?? null);
    return {
      ...r,
      recordId: record?.id ?? null,
      netSalaryEur: record?.netSalaryEur ?? null,
      bankName: record?.bankName ?? null,
      accountHolder: record?.accountHolder ?? null,
      idCardNumber: opts.reveal ? idCard : maskLast4(idCard),
      iban: opts.reveal ? iban : maskLast4(iban),
      updatedAt: record?.updatedAt ?? null,
      updatedByName: record ? r.updatedByName : null,
    };
  });
}
