import { createHash, randomBytes } from "node:crypto";
import { db, schema } from "@canvas/db";
import {
  REQUESTABLE_PEOPLE_ROLES,
  allowedEmailMessage,
  isAllowedEmail,
  parseAllowedEmailDomains,
  type RequestablePeopleRole,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { getEmailClient } from "../email";
import { env } from "../env";
import { assertEmailSendRateLimit } from "./rate-limit";
import { recordRoleRequest } from "./role-requests";

const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Who may hold a Canvas account: an email on an allowed domain, and no one else. */
export function assertAllowedEmail(email: string) {
  const domains = parseAllowedEmailDomains(env.ALLOWED_EMAIL_DOMAINS);
  if (!isAllowedEmail(email, domains)) {
    throw new TRPCError({ code: "FORBIDDEN", message: allowedEmailMessage(domains) });
  }
}

export function emailIsAllowed(email: string) {
  return isAllowedEmail(email, parseAllowedEmailDomains(env.ALLOWED_EMAIL_DOMAINS));
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Only for e2e (E2E_TEST_HOOKS, refused in production): the mock email client
// has no inbox to read a link from. See routes/test-hooks.ts.
const linksForTests = new Map<string, string>();
export const lastSignupLinkForTests = (email: string) => linksForTests.get(email.toLowerCase());

async function send(to: string, subject: string, text: string) {
  try {
    await getEmailClient().send({ to, subject, text });
  } catch (err) {
    console.error(`[signup] email to ${to} failed:`, err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "We couldn't send the email. Try again in a moment.",
    });
  }
}

/**
 * Step 1 of signing up: prove the address is yours. Nothing is created yet, and
 * no password is chosen until the emailed link is opened, so typing a colleague's
 * address gets you nothing, and can't leave a password on their future account.
 * The answer is the same whether or not an account exists.
 */
export async function requestSignUp(input: {
  email: string;
  name: string;
  inviteId?: string;
  requestedRole?: RequestablePeopleRole;
}) {
  assertAllowedEmail(input.email);
  await assertEmailSendRateLimit(input.email);
  if (process.env.NODE_ENV === "production" && !env.SMTP_HOST) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Canvas can't send email yet, so sign-up isn't open. Ask your administrator.",
    });
  }

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, input.email),
    columns: { id: true },
  });
  if (existing) {
    await send(
      input.email,
      "You already have a Canvas account",
      `Someone tried to sign up with this address, and it already has an account. If it was you, log in here: ${env.WEB_URL}/login\n\nForgot your password? Reset it here: ${env.WEB_URL}/forgot-password\n\nIf it wasn't, you can ignore this email.`,
    );
    return;
  }

  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    // Only the newest link for an address works.
    await tx
      .update(schema.signupRequests)
      .set({ usedAt: new Date() })
      .where(
        and(eq(schema.signupRequests.email, input.email), isNull(schema.signupRequests.usedAt)),
      );
    await tx.insert(schema.signupRequests).values({
      email: input.email,
      name: input.name,
      tokenHash: hashToken(token),
      inviteId: input.inviteId ?? null,
      requestedRole: input.requestedRole ?? null,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    });
  });

  const path = `/signup/confirm?token=${token}`;
  await send(
    input.email,
    "Confirm your email to join Canvas",
    `Hi ${input.name},\n\nOpen this link to confirm your email and choose a password. It works for 24 hours.\n\n${env.WEB_URL}${path}\n\nIf you didn't ask for this, you can ignore this email.`,
  );
  if (env.E2E_TEST_HOOKS) linksForTests.set(input.email.toLowerCase(), path);
  // Local development has no real inbox unless SMTP is set up.
  if (process.env.NODE_ENV !== "production" && !env.SMTP_HOST) {
    console.log(`[signup] confirm link for ${input.email}: ${env.WEB_URL}${path}`);
  }
}

async function findLiveRequest(token: string) {
  const request = await db.query.signupRequests.findFirst({
    where: and(
      eq(schema.signupRequests.tokenHash, hashToken(token)),
      isNull(schema.signupRequests.usedAt),
      gt(schema.signupRequests.expiresAt, new Date()),
    ),
  });
  if (!request) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This link has expired or was already used. Sign up again to get a new one.",
    });
  }
  return request;
}

/** What the confirm page shows. */
export async function describeSignUp(token: string) {
  const request = await findLiveRequest(token);
  return { email: request.email, name: request.name };
}

/** Step 2: the link was opened, so the address is theirs. Now the account exists. */
export async function completeSignUp(token: string, password: string) {
  const request = await findLiveRequest(token);
  assertAllowedEmail(request.email);
  const passwordHash = await hashPassword(password);

  const { user, invite } = await db.transaction(async (tx) => {
    // Claimed first, so opening the link twice at once can't make two accounts.
    const [claimed] = await tx
      .update(schema.signupRequests)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.signupRequests.id, request.id), isNull(schema.signupRequests.usedAt)))
      .returning({ id: schema.signupRequests.id });
    if (!claimed) {
      throw new TRPCError({ code: "NOT_FOUND", message: "This link was already used." });
    }
    const taken = await tx.query.users.findFirst({
      where: eq(schema.users.email, request.email),
      columns: { id: true },
    });
    if (taken) {
      throw new TRPCError({ code: "CONFLICT", message: "This address already has an account." });
    }
    const [created] = await tx
      .insert(schema.users)
      .values({ email: request.email, name: request.name, passwordHash })
      .returning();
    if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const pendingInvite = request.inviteId
      ? await tx.query.invites.findFirst({
          where: and(
            eq(schema.invites.id, request.inviteId),
            eq(schema.invites.email, request.email),
            isNull(schema.invites.acceptedAt),
          ),
        })
      : undefined;
    if (!pendingInvite || pendingInvite.expiresAt.getTime() <= Date.now()) {
      return { user: created, invite: null };
    }
    await tx.insert(schema.memberships).values({
      workspaceId: pendingInvite.workspaceId,
      userId: created.id,
      role: pendingInvite.role,
      customRoleId: pendingInvite.customRoleId,
    });
    await tx
      .update(schema.invites)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invites.id, pendingInvite.id));
    await tx.insert(schema.activity).values({
      workspaceId: pendingInvite.workspaceId,
      actorId: created.id,
      entityType: "membership",
      entityId: created.id,
      verb: "invite.accepted",
    });
    return { user: created, invite: pendingInvite };
  });

  const requested = REQUESTABLE_PEOPLE_ROLES.find((r) => r === request.requestedRole);
  if (invite && requested) await recordRoleRequest(invite.workspaceId, user.id, requested);
  return user;
}
