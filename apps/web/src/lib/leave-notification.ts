import { LEAVE_TYPES, formatDmy, leaveMessages, type LeaveType } from "@canvas/shared";

type LeavePayload = {
  type?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  workingDays?: unknown;
  returnDate?: unknown;
  note?: unknown;
};

function parse(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as LeavePayload;
  if (
    typeof p.type !== "string" ||
    !(LEAVE_TYPES as readonly string[]).includes(p.type) ||
    typeof p.startDate !== "string" ||
    typeof p.endDate !== "string"
  ) {
    return null;
  }
  return {
    type: p.type as LeaveType,
    startDate: p.startDate,
    endDate: p.endDate,
    workingDays: typeof p.workingDays === "number" ? p.workingDays : 0,
    returnDate: typeof p.returnDate === "string" ? p.returnDate : null,
    note: typeof p.note === "string" ? p.note : "",
  };
}

/**
 * P8.4: the sentence a leave notification reads as — the same text the
 * email carries (packages/shared leaveMessages). null for other verbs or an
 * unreadable payload, so callers fall back to the generic label.
 */
export function leaveNotificationText(
  verb: string,
  payload: unknown,
  actorName: string,
): string | null {
  const p = parse(payload);
  if (!p) return null;
  if (verb === "leave.requested") return leaveMessages.requested({ name: actorName, ...p });
  if (verb === "leave.approved") {
    return p.returnDate
      ? leaveMessages.approved({ ...p, returnDate: p.returnDate })
      : `Your leave from ${formatDmy(p.startDate)} until ${formatDmy(p.endDate)} has been approved.`;
  }
  if (verb === "leave.rejected") return leaveMessages.rejected({ ...p, reason: p.note });
  return null;
}
