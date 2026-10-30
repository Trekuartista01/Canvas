// Every date/time rule in the app runs on Kosovo time. Never hard-code a
// UTC offset — Europe/Belgrade switches between CET and CEST.
export const APP_TIME_ZONE = "Europe/Belgrade";

/** The wall-clock date ("YYYY-MM-DD") and time ("HH:MM:SS") at `now` in APP_TIME_ZONE. */
export function wallClock(now: Date, timeZone = APP_TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/** "14:30:00" / "14:30" → "14:30"; null stays null. */
export function formatDueTime(dueTime: string | null | undefined): string | null {
  return dueTime ? dueTime.slice(0, 5) : null;
}

/**
 * Past its due date (+ time, if set) in Kosovo time. A task with a due date
 * but no time is due by the end of that day. Finished tasks are never
 * overdue — callers pass `done` from the status kind.
 */
export function isOverdue(
  task: { dueDate: string | null; dueTime?: string | null; done?: boolean },
  now: Date,
): boolean {
  if (!task.dueDate || task.done) return false;
  const current = wallClock(now);
  const dueTime = task.dueTime ? `${task.dueTime.slice(0, 5)}:00` : "23:59:59";
  return `${current.date}T${current.time}` > `${task.dueDate}T${dueTime}`;
}
