import { APP_TIME_ZONE } from "@canvas/shared";

/** "Fri 30 Oct 2026" for a "YYYY-MM-DD" report date. */
export function formatReportDate(reportDate: string): string {
  return new Date(`${reportDate}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "17:02" in Kosovo time — report times are about the Kosovo working day. */
export function formatReportTime(at: Date | string): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: APP_TIME_ZONE,
  });
}
