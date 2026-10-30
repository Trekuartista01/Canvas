// M7.6 employment contracts + company document library.
export const CONTRACT_KINDS = ["contract", "annex", "amendment"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  contract: "Contract",
  annex: "Annex",
  amendment: "Amendment",
};

/** HR hears about an expiring contract this many days before it ends. */
export const CONTRACT_EXPIRY_NOTICE_DAYS = [30, 7] as const;

/** Calendar days from `today` to `date` (both "YYYY-MM-DD"); negative once past. */
export function daysUntil(today: string, date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Which expiry notices are due on `today` for a contract ending `expiryDate`:
 * every threshold we're at or inside of, as long as it hasn't expired yet.
 * The notice ledger records each one once, so a 30-day notice missed while
 * the worker was down still goes out, and one created 5 days before expiry
 * gets a single (7-day) notice rather than both.
 */
export function contractNoticesDue(
  today: string,
  expiryDate: string,
  thresholds: readonly number[] = CONTRACT_EXPIRY_NOTICE_DAYS,
): number[] {
  const left = daysUntil(today, expiryDate);
  if (left < 0) return [];
  return thresholds.filter((t) => left <= t);
}
