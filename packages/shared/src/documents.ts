import { APP_TIME_ZONE, wallClock } from "./due";
import { formatDmy } from "./leave";
import { previousWorkingDay, type HolidayCalendar } from "./working-days";

// M7.6 employment contracts + company document library.
export const CONTRACT_KINDS = ["contract", "annex", "amendment"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  contract: "Contract",
  annex: "Annex",
  amendment: "Amendment",
};

/** Calendar days from `today` to `date` (both "YYYY-MM-DD"); negative once past. */
export function daysUntil(today: string, date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------
// P8.6 (docs/hr-ops-spec.md §6): contract files and the end-date alert.

/** Photos of a paper contract or a scanned PDF — nothing else. */
export const CONTRACT_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
export type ContractFileMime = (typeof CONTRACT_FILE_MIME_TYPES)[number];
export const MAX_CONTRACT_FILE_BYTES = 20 * 1024 ** 2;
/** Files per upload (a multi-page contract photographed page by page). */
export const MAX_CONTRACT_FILES_PER_UPLOAD = 30;
export const CONTRACT_FILE_ACCEPT = ".jpg,.jpeg,.png,.heic,.heif,.pdf";

const MIME_BY_EXTENSION: Record<string, ContractFileMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

/**
 * The type a contract file is stored as, or null if it isn't allowed. The
 * extension decides when the browser reports nothing (Windows gives HEIC
 * photos an empty type); a reported type must agree with the extension.
 */
export function contractFileMime(fileName: string, reportedType: string): ContractFileMime | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const byExt = MIME_BY_EXTENSION[ext];
  if (!byExt) return null;
  const reported = reportedType.trim().toLowerCase();
  if (!reported || reported === "application/octet-stream") return byExt;
  if (reported === "image/jpg") return byExt === "image/jpeg" ? byExt : null;
  return reported === byExt ? byExt : null;
}

/**
 * Which of `files` may join an upload that already holds `existingCount`, and
 * a sentence for each one refused.
 */
export function checkContractFiles<F extends { name: string; type: string; size: number }>(
  existingCount: number,
  files: F[],
): { accepted: F[]; errors: string[] } {
  const accepted: F[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!contractFileMime(file.name, file.type)) {
      errors.push(`${file.name}: contracts can be JPG, PNG, HEIC or PDF`);
    } else if (file.size > MAX_CONTRACT_FILE_BYTES) {
      errors.push(`${file.name}: files can be up to 20 MB`);
    } else if (existingCount + accepted.length >= MAX_CONTRACT_FILES_PER_UPLOAD) {
      errors.push(`${file.name}: up to ${MAX_CONTRACT_FILES_PER_UPLOAD} files at a time`);
    } else {
      accepted.push(file);
    }
  }
  return { accepted, errors };
}

/** Shown as a thumbnail in the browser (HEIC and PDF get a file tile instead). */
export function isPreviewableImage(mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/png";
}

/** The Contracts page's "Ending soon" badge — visual only, no notification. */
export const CONTRACT_ENDING_SOON_DAYS = 30;

export function isContractEndingSoon(today: string, endDate: string | null): boolean {
  if (!endDate) return false;
  const left = daysUntil(today, endDate);
  return left >= 0 && left <= CONTRACT_ENDING_SOON_DAYS;
}

export type ContractStatus = "none" | "valid" | "ending";

/**
 * The colour of a person's name on the Contracts page. Their latest end date
 * decides, so a renewal turns them back to valid: "ending" starts on the day
 * HR is alerted and stays after the contract has ended. A contract with no
 * end date is valid; an annex with no end date says nothing either way.
 */
export function personContractStatus(
  today: string,
  documents: { kind: ContractKind; expiryDate: string | null; endAlertDay: string | null }[],
): { status: ContractStatus; endDate: string | null } {
  if (documents.some((d) => d.kind === "contract" && !d.expiryDate)) {
    return { status: "valid", endDate: null };
  }
  let latest: (typeof documents)[number] | null = null;
  for (const d of documents) {
    if (d.expiryDate && (!latest || d.expiryDate > latest.expiryDate!)) latest = d;
  }
  if (!latest) return { status: "none", endDate: null };
  return {
    status: latest.endAlertDay && today >= latest.endAlertDay ? "ending" : "valid",
    endDate: latest.expiryDate,
  };
}

/** The daily alert job runs from 08:00 Kosovo time. */
export const CONTRACT_ALERT_TIME = "08:00:00";

/**
 * The day HR hears that a contract ends: the last working day before the end
 * date (spec §6) — Tue 03.11.2026 → Mon 02.11.2026; Mon 04.01.2027 → Thu
 * 31.12.2026. Also when the end date itself is a weekend or holiday.
 */
export function contractAlertDay(endDate: string, holidays: HolidayCalendar): string {
  return previousWorkingDay(endDate, holidays);
}

/**
 * Whether the alert for a contract ending `endDate` should go out at
 * `nowUtc`: from 08:00 Kosovo time on the alert day, and — so a server that
 * was down that day catches up — on any later day before the contract ends.
 * end_alert_sent_at is what makes it go out once.
 */
export function isContractAlertDue(
  nowUtc: Date,
  endDate: string,
  holidays: HolidayCalendar,
  timeZone: string = APP_TIME_ZONE,
): boolean {
  const local = wallClock(nowUtc, timeZone);
  if (local.date >= endDate) return false;
  const alertDay = contractAlertDay(endDate, holidays);
  if (local.date > alertDay) return true;
  return local.date === alertDay && local.time >= CONTRACT_ALERT_TIME;
}

/** The spec's alert sentence, Albanian then English (notification + email). */
export const contractMessages = {
  ending: (c: { name: string; endDate: string }) =>
    `Kontrata e ${c.name} përfundon më ${formatDmy(c.endDate)}. / ${c.name}'s contract ends on ${formatDmy(c.endDate)}.`,
};
