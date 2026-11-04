import type { FastifyReply } from "fastify";
import { SESSION_COOKIE_NAME } from "./session";

const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

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
