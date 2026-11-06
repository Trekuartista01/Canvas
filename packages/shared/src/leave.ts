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
  // P8.4 (spec §3): "Annual leave / Pushim vjetor" — the only type with a balance and a Vendim.
  vacation: "Annual leave (Pushim vjetor)",
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

/** HR's rule: from `years` of service on, a person gets `days` a year. */
export interface VacationTenureRule {
  years: number;
  days: number;
}

/** Whole months from `startDate` to `asOf`, both YYYY-MM-DD; negative before the start. */
export function serviceMonths(startDate: string, asOf: string): number {
  const part = (date: string) => date.split("-").map(Number) as [number, number, number];
  const [startYear, startMonth, startDay] = part(startDate);
  const [year, month, day] = part(asOf);
  return (year - startYear) * 12 + month - startMonth - (day < startDay ? 1 : 0);
}

/**
 * A person's annual leave for `year` when HR hasn't typed their own number:
 * the highest rule their service has reached by the end of that year, so the
 * whole year counts as the one they reach it in. Without a start date, or
 * below every rule, it's the workspace default.
 */
export function vacationDaysForService(input: {
  defaultDays: number;
  rules: VacationTenureRule[];
  employmentStartDate: string | null;
  year: number;
}): number {
  if (!input.employmentStartDate) return input.defaultDays;
  const months = serviceMonths(input.employmentStartDate, `${input.year}-12-31`);
  if (months < 0) return input.defaultDays;
  let best: VacationTenureRule | null = null;
  for (const rule of input.rules) {
    if (rule.years * 12 <= months && (!best || rule.years > best.years)) best = rule;
  }
  return best ? best.days : input.defaultDays;
}

/** "2 yrs 3 mos", for the balances table. */
export function formatServiceMonths(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years > 0 ? `${years} yr${years === 1 ? "" : "s"}` : "",
    rest > 0 || years === 0 ? `${rest} mo${rest === 1 ? "" : "s"}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** "30.12.2026" — the Kosovo date format used in leave messages and the Vendim. */
export function formatDmy(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** "annual leave", "sick leave", … for sentences. */
export function leavePhrase(type: LeaveType): string {
  return type === "vacation" ? "annual leave" : LEAVE_TYPE_LABELS[type].toLowerCase();
}

const daysText = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;

/**
 * P8.4 notification/email texts (spec §3), shared by the in-app bell and
 * the emails so both read the same.
 */
export const leaveMessages = {
  requested: (r: {
    name: string;
    type: LeaveType;
    startDate: string;
    endDate: string;
    workingDays: number;
  }) =>
    `${r.name} has requested ${leavePhrase(r.type)} from ${formatDmy(r.startDate)} until ${formatDmy(r.endDate)} (${daysText(r.workingDays)}).`,
  approved: (r: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    workingDays: number;
    returnDate: string;
  }) => {
    const phrase = leavePhrase(r.type);
    return `Your ${phrase} from ${formatDmy(r.startDate)} until ${formatDmy(r.endDate)} (${daysText(r.workingDays)}) has been approved. You are expected back at work on ${formatDmy(r.returnDate)}.`;
  },
  rejected: (r: { type: LeaveType; startDate: string; endDate: string; reason: string }) =>
    `Your ${leavePhrase(r.type)} request from ${formatDmy(r.startDate)} until ${formatDmy(r.endDate)} was not approved. Reason: ${r.reason}`,
};
