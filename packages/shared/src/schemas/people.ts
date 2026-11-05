import { z } from "zod";
import { CONTRACT_TYPES, PAY_CURRENCIES, PEOPLE_ROLES } from "../people";
import { emailSchema, passwordSchema } from "./auth";

const workspaceId = z.string().uuid();
const userId = z.string().uuid();
const peopleRoleEnum = z.enum(PEOPLE_ROLES);
// Empty string from a cleared form field means "unset".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const workspaceScopedSchema = z.object({ workspaceId });

export const peopleDirectorySchema = z.object({
  workspaceId,
  includeInactive: z.boolean().default(false),
});

export const peopleMemberSchema = z.object({ workspaceId, userId });

// The editable HR fields of employee_profiles.
export const employeeProfileFieldsSchema = z.object({
  phone: optionalText(50),
  address: optionalText(300),
  dateOfBirth: optionalDate,
  jobTitle: optionalText(100),
  department: optionalText(100),
  employmentStartDate: optionalDate,
  emergencyContactName: optionalText(100),
  emergencyContactPhone: optionalText(50),
});

// HR creates the account directly (name, email, initial password) — the new
// member logs in with it. Existing accounts can't be attached this way (they
// go through the normal invite link, which the account holder accepts).
export const createStaffSchema = employeeProfileFieldsSchema.extend({
  workspaceId,
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
  peopleRole: peopleRoleEnum.default("employee"),
  managerUserId: userId.nullable().optional(),
});

export const updateEmployeeProfileSchema = employeeProfileFieldsSchema.extend({
  workspaceId,
  userId,
});

// What anyone can set on their own profile; the rest of it is HR's to keep.
export const updateMyProfileSchema = employeeProfileFieldsSchema
  .pick({ jobTitle: true, department: true, dateOfBirth: true })
  .extend({ workspaceId });

export const setPeopleRoleSchema = z.object({ workspaceId, userId, peopleRole: peopleRoleEnum });

export const listRoleRequestsSchema = z.object({ workspaceId });

export const decideRoleRequestSchema = z.object({ workspaceId, userId, approve: z.boolean() });

export const setManagerSchema = z.object({ workspaceId, userId, managerUserId: userId.nullable() });

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type EmployeeProfileFields = z.infer<typeof employeeProfileFieldsSchema>;

// P8.3: archive = remove from lists and block login; history stays (spec §5).
export const archivePersonSchema = z.object({ workspaceId, userId });

const money = z.number().min(0).max(9_999_999_999.99).multipleOf(0.01).nullable().optional();

// The HR-only Confidential tab. undefined = leave as is, null = clear.
// Salary and bank fields are written to payroll_records, the rest to
// employee_profiles.
export const updateConfidentialSchema = z
  .object({
    workspaceId,
    userId,
    personalNumber: z.string().trim().min(1).max(40).nullable().optional(),
    payCurrency: z.enum(PAY_CURRENCIES).optional(),
    contractType: z.enum(CONTRACT_TYPES).nullable().optional(),
    contractStart: optionalDate,
    contractEnd: optionalDate,
    grossSalary: money,
    netSalary: money,
  })
  .refine((v) => !v.contractStart || !v.contractEnd || v.contractEnd >= v.contractStart, {
    message: "The contract can't end before it starts",
    path: ["contractEnd"],
  });

export type UpdateConfidentialInput = z.infer<typeof updateConfidentialSchema>;
