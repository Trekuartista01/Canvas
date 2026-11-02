import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { SESSION_COOKIE_NAME, validateSession, type SessionUser } from "../auth/session";

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  const sessionId = req.cookies[SESSION_COOKIE_NAME];
  let user: SessionUser | null = null;

  if (sessionId) {
    const result = await validateSession(sessionId);
    user = result?.user ?? null;
  }

  // The client's address for audit_log (lib/audit.ts).
  return { req, res, user, sessionId: sessionId ?? null, ip: req.ip ?? null };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
