import { z } from "zod";
import { LEAVE_TYPES } from "../leave";

// A scan or photo of a doctor's note — nowhere near the task-attachment cap.
export const MAX_LEAVE_DOCUMENT_BYTES = 20 * 1024 ** 2;

const workspaceId = z.string().uuid();
const year = z.number().int().min(2000).max(2100);
const days = z.number().min(0).max(366);

const leaveDates = {
  type: z.enum(LEAVE_TYPES),
  startDate: z.string().date(),
  endDate: z.string().date(),
};

// M7.5 — working days are always computed server-side (weekends and the
// workspace's observed public holidays excluded), never client-supplied.
export const previewLeaveSchema = z.object({
  workspaceId,
  ...leaveDates,
  userId: z.string().uuid().optional(),
});

export const requestLeaveSchema = z.object({
  workspaceId,
  ...leaveDates,
  reason: z.string().trim().max(2000).optional(),
  documentAttachmentId: z.string().uuid().optional(),
});

// HR records leave on someone's behalf — approved immediately.
export const recordLeaveSchema = requestLeaveSchema.extend({ userId: z.string().uuid() });

export const decideLeaveSchema = z
  .object({
    leaveRequestId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    // Required when rejecting — enforced in a refine below.
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === "approved" || !!v.note, {
    message: "Say why when rejecting",
    path: ["note"],
  });

export const leaveRequestIdSchema = z.object({ leaveRequestId: z.string().uuid() });

export const leaveBalanceSchema = z.object({
  workspaceId,
  year,
  userId: z.string().uuid().optional(),
});

export const leaveTeamSchema = z.object({
  workspaceId,
  status: z.enum(["pending", "all"]).default("pending"),
});

export const leaveCalendarSchema = z.object({
  workspaceId,
  from: z.string().date(),
  to: z.string().date(),
});

export const setLeaveBalanceSchema = z.object({
  workspaceId,
  userId: z.string().uuid(),
  year,
  // null = back to the workspace default / not yet computed.
  entitlementDays: days.nullable().optional(),
  carriedOverDays: days.nullable().optional(),
});

export const setDefaultVacationDaysSchema = z.object({ workspaceId, days });

export const presignLeaveDocumentSchema = z.object({
  workspaceId,
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_LEAVE_DOCUMENT_BYTES),
});

export const confirmLeaveDocumentSchema = z.object({
  workspaceId,
  attachmentId: z.string().uuid(),
  key: z.string().min(1),
  fileName: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200),
});
