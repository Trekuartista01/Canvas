// M7.5 leave management — hand-synced with the leave_type / leave_status
// pgEnums, same pattern as PEOPLE_ROLES.
export const LEAVE_TYPES = [
  "sick",
  "vacation",
  "personal",
  "maternity",
  "paternity",
  "emergency",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: "Sick leave",
  vacation: "Vacation",
  personal: "Personal leave",
  maternity: "Maternity leave",
  paternity: "Paternity leave",
  emergency: "Emergency leave",
};

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Workspace default vacation entitlement (working days a year) — HR confirms/changes it. */
export const DEFAULT_VACATION_DAYS = 20;
