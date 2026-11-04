import { randomBytes } from "node:crypto";
import { db, schema } from "@canvas/db";
import { TRPCError } from "@trpc/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { sendEmail } from "../email/send-email";
import { env } from "../env";
import { assertEmailSendRateLimit } from "./rate-limit";
import { emailIsAllowed, hashToken } from "./signup";

const LINK_TTL_MS = 60 * 60 * 1000;

// Only for e2e (E2E_TEST_HOOKS, refused in production): the mock email client
// has no inbox to read a link from. See routes/test-hooks.ts.
const linksForTests = new Map<string, string>();
export const lastResetLinkForTests = (email: string) => linksForTests.get(email.toLowerCase());

async function sendResetEmail(email: string) {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
    columns: { id: true, name: true },
  });
  if (!user || !emailIsAllowed(email)) return;

  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    // Only the newest link works.
    await tx
      .update(schema.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.passwordResetTokens.userId, user.id),
          isNull(schema.passwordResetTokens.usedAt),
        ),
      );
    await tx.insert(schema.passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    });
  });

  const path = `/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: "Reset your Canvas password",
    text: `Hi ${user.name},\n\nOpen this link to choose a new password. It works for 1 hour.\n\n${env.WEB_URL}${path}\n\nIf you didn't ask for this, you can ignore this email: your password hasn't changed.`,
  });
  if (env.E2E_TEST_HOOKS) linksForTests.set(email.toLowerCase(), path);
  // Local development has no real inbox unless SMTP is set up.
  if (process.env.NODE_ENV !== "production" && !env.SMTP_HOST) {
    console.log(`[password-reset] link for ${email}: ${env.WEB_URL}${path}`);
  }
}

/**
 * Step 1 of "forgot password". The caller gets the same answer, in about the
 * same time, whether or not the address has an account: the work happens after
 * responding, so neither the words nor the delay reveal who's a user. The hourly
 * limit counts every address alike, for the same reason.
 */
export async function requestPasswordReset(email: string) {
  await assertEmailSendRateLimit(email);
  void sendResetEmail(email).catch((err: unknown) => {
    console.error("[password-reset] failed:", err);
  });
}

async function findLiveToken(token: string) {
  const row = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(schema.passwordResetTokens.tokenHash, hashToken(token)),
      isNull(schema.passwordResetTokens.usedAt),
      gt(schema.passwordResetTokens.expiresAt, new Date()),
    ),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This link has expired or was already used. Ask for a new one.",
    });
  }
  return row;
}

/** The page behind the link: is it still good, and whose is it? */
export async function describePasswordReset(token: string) {
  const row = await findLiveToken(token);
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, row.userId),
    columns: { email: true },
  });
  if (!user) throw new TRPCError({ code: "NOT_FOUND" });
  return { email: user.email };
}

/**
 * Step 2: sets the password and signs out every device, so whoever may have had
 * the old password loses access now. The person logs in again with the new one.
 */
export async function completePasswordReset(token: string, password: string) {
  const row = await findLiveToken(token);
  const passwordHash = await hashPassword(password);
  const email = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(schema.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(eq(schema.passwordResetTokens.id, row.id), isNull(schema.passwordResetTokens.usedAt)),
      )
      .returning({ id: schema.passwordResetTokens.id });
    if (!claimed)
      throw new TRPCError({ code: "NOT_FOUND", message: "This link was already used." });
    const [user] = await tx
      .update(schema.users)
      .set({ passwordHash })
      .where(eq(schema.users.id, row.userId))
      .returning({ email: schema.users.email });
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.userId));
    return user.email;
  });
  await sendEmail({
    to: email,
    subject: "Your Canvas password was changed",
    text: `Your Canvas password was just changed, and every device was signed out.\n\nIf this wasn't you, reset it now: ${env.WEB_URL}/forgot-password`,
  });
}
