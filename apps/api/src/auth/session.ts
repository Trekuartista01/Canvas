import { db, schema } from "@canvas/db";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { SESSION_TTL_MS, shouldRenewSession } from "./session-lifetime";

export const SESSION_COOKIE_NAME = "canvas_session";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  title: string | null;
}

export async function createSession(userId: string) {
  const [session] = await db
    .insert(schema.sessions)
    .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .returning();
  return session!;
}

export async function validateSession(sessionId: string): Promise<{
  session: typeof schema.sessions.$inferSelect;
  user: SessionUser;
  /** The expiry moved, so the browser's cookie needs to move with it. */
  renewed: boolean;
} | null> {
  const [row] = await db
    .select({
      session: schema.sessions,
      user: {
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
        bio: schema.users.bio,
        title: schema.users.title,
      },
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, sessionId));

  if (!row) return null;

  if (row.session.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    return null;
  }

  let renewed = false;
  if (shouldRenewSession(row.session.expiresAt)) {
    renewed = true;
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db
      .update(schema.sessions)
      .set({ expiresAt: newExpiresAt })
      .where(eq(schema.sessions.id, sessionId));
    row.session.expiresAt = newExpiresAt;
  }

  return { ...row, renewed };
}

export async function invalidateSession(sessionId: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

// For plain Fastify routes outside tRPC's context (file upload/download —
// see routes/attachments.ts), mirroring the same cookie-based lookup
// createContext does for tRPC procedures.
export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const sessionId = req.cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const result = await validateSession(sessionId);
  return result?.user ?? null;
}
