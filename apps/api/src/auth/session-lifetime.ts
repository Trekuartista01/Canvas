const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * A login lasts until the person logs out, or doesn't use Canvas for this long.
 * Browsers cap a cookie at 400 days, and each day of use starts the clock again.
 */
export const SESSION_TTL_MS = 365 * DAY_MS;

/** At most once a day, so ordinary requests don't all write to the database. */
export function shouldRenewSession(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() - now.getTime() < SESSION_TTL_MS - DAY_MS;
}
