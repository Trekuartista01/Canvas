import { z } from "zod";
import { PEOPLE_ROLES } from "../people";
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
  peopleRole: peopleRoleEnum.default("staff"),
  managerUserId: userId.nullable().optional(),
});

export const updateEmployeeProfileSchema = employeeProfileFieldsSchema.extend({
  workspaceId,
  userId,
});

export const setPeopleRoleSchema = z.object({ workspaceId, userId, peopleRole: peopleRoleEnum });

export const setManagerSchema = z.object({ workspaceId, userId, managerUserId: userId.nullable() });

export const setEmployeeStatusSchema = z.object({
  workspaceId,
  userId,
  status: z.enum(["active", "inactive"]),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type EmployeeProfileFields = z.infer<typeof employeeProfileFieldsSchema>;
