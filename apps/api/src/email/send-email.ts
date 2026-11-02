import { db, schema } from "@canvas/db";
import { inArray } from "drizzle-orm";
import { getEmailClient } from "./index";
import type { EmailMessage } from "./types";

/**
 * P8.1: the one way app code sends a notification email. Goes through the
 * configured EmailClient (SMTP, or the mock in dev/tests), so the transport
 * can change without touching callers. Never throws: a failed email is
 * logged and the action that triggered it still succeeds.
 */
export async function sendEmail(message: EmailMessage) {
  try {
    await getEmailClient().send(message);
  } catch (err) {
    console.error(`[email] to ${message.to} failed:`, err);
  }
}

/** The same email to each of these users. */
export async function emailUsers(userIds: string[], subject: string, text: string) {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  for (const { email } of rows) await sendEmail({ to: email, subject, text });
}
