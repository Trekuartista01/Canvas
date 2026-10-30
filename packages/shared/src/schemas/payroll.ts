import { z } from "zod";
import { isValidIban, normalizeIban } from "../payroll";

const workspaceId = z.string().uuid();

export const payrollMemberSchema = z.object({ workspaceId, userId: z.string().uuid() });

// M7.7. Every field optional: undefined = leave as is, null = clear it.
export const upsertPayrollSchema = z.object({
  workspaceId,
  userId: z.string().uuid(),
  netSalaryEur: z.number().min(0).max(9_999_999_999.99).multipleOf(0.01).nullable().optional(),
  idCardNumber: z.string().trim().min(1).max(40).nullable().optional(),
  bankName: z.string().trim().min(1).max(120).nullable().optional(),
  iban: z
    .string()
    .transform(normalizeIban)
    .refine(isValidIban, "That IBAN isn't valid — check the digits")
    .nullable()
    .optional(),
  accountHolder: z.string().trim().min(1).max(120).nullable().optional(),
});
