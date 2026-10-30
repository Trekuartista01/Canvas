import { APP_TIME_ZONE, wallClock } from "./due";
import { isWorkingDay } from "./holidays";

// M7.3: the daily-report reminder goes out at 16:45 Kosovo time on working
// days (Mon–Fri, minus the workspace's public holidays — see ./holidays.ts).
export const DAILY_REPORT_REMINDER_TIME = "16:45:00";

/**
 * Whether the reminder should go out at `nowUtc`, and for which report date.
 * True from 16:45 local time until midnight on a working day, so a worker
 * that was down at 16:45 still catches up later that evening — the reminder
 * ledger (daily_report_reminders) is what makes it fire only once.
 */
export function isReminderDue(
  nowUtc: Date,
  timeZone: string = APP_TIME_ZONE,
  isHoliday?: (date: string) => boolean,
): { due: boolean; reportDate: string } {
  const local = wallClock(nowUtc, timeZone);
  return {
    due: local.time >= DAILY_REPORT_REMINDER_TIME && isWorkingDay(local.date, isHoliday),
    reportDate: local.date,
  };
}

/** Today's report date in Kosovo time — the only date a report can be saved for. */
export function todayReportDate(now: Date, timeZone: string = APP_TIME_ZONE): string {
  return wallClock(now, timeZone).date;
}
