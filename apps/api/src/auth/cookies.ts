import type { FastifyReply } from "fastify";
import { SESSION_COOKIE_NAME } from "./session";
import { SESSION_TTL_MS } from "./session-lifetime";

const SESSION_COOKIE_MAX_AGE_SEC = Math.floor(SESSION_TTL_MS / 1000);

function cookieBase() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function setSessionCookie(res: FastifyReply, sessionId: string) {
  res.setCookie(SESSION_COOKIE_NAME, sessionId, {
    ...cookieBase(),
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  });
}

export function clearSessionCookie(res: FastifyReply) {
  // Must mirror setCookie options (esp. `secure`) or browsers keep the cookie.
  res.clearCookie(SESSION_COOKIE_NAME, cookieBase());
}
