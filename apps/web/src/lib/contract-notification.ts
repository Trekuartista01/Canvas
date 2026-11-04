import { contractMessages } from "@canvas/shared";

/** P8.6 "contract.expiring": who to open on the Contracts page. */
export function contractNotificationPerson(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const userId = (payload as { userId?: unknown }).userId;
  return typeof userId === "string" ? userId : undefined;
}

/** P8.6 "contract.expiring": the spec's sentence, Albanian then English. */
export function contractNotificationText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as { employeeName?: unknown; expiryDate?: unknown };
  if (typeof p.employeeName !== "string" || typeof p.expiryDate !== "string") return "";
  return contractMessages.ending({ name: p.employeeName, endDate: p.expiryDate });
}
