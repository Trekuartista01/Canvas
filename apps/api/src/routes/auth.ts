import { generateCodeVerifier, generateState, OAuth2RequestError } from "arctic";
import type { FastifyInstance } from "fastify";
import { oauthCookieOptions, setSessionCookie } from "../auth/cookies";
import { fetchGoogleUserInfo, getGoogleClient } from "../auth/google";
import { createSession } from "../auth/session";
import { env } from "../env";
import { assertAuthRateLimit, RateLimitError } from "../lib/rate-limit";
import { emailIsAllowed } from "../lib/signup";
import { findOrCreateUserByEmail } from "../lib/user-provisioning";

const OAUTH_STATE_COOKIE = "canvas_oauth_state";
const OAUTH_VERIFIER_COOKIE = "canvas_oauth_verifier";
const OAUTH_COOKIE_MAX_AGE_SEC = 60 * 10;

export function registerAuthRoutes(app: FastifyInstance) {
  app.get("/auth/google", async (req, reply) => {
    try {
      await assertAuthRateLimit(req.ip);
    } catch (err) {
      if (err instanceof RateLimitError) {
        return reply.code(429).send({ error: err.message });
      }
      throw err;
    }

    const google = getGoogleClient();
    if (!google) {
      return reply.redirect(`${env.WEB_URL}/login?error=google_not_configured`);
    }

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const cookieOpts = oauthCookieOptions(OAUTH_COOKIE_MAX_AGE_SEC);

    reply.setCookie(OAUTH_STATE_COOKIE, state, cookieOpts);
    reply.setCookie(OAUTH_VERIFIER_COOKIE, codeVerifier, cookieOpts);

    const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/google/callback",
    async (req, reply) => {
      const google = getGoogleClient();
      const { code, state } = req.query;
      const storedState = req.cookies[OAUTH_STATE_COOKIE];
      const codeVerifier = req.cookies[OAUTH_VERIFIER_COOKIE];

      reply.clearCookie(OAUTH_STATE_COOKIE, oauthCookieOptions(OAUTH_COOKIE_MAX_AGE_SEC));
      reply.clearCookie(OAUTH_VERIFIER_COOKIE, oauthCookieOptions(OAUTH_COOKIE_MAX_AGE_SEC));

      if (!google || !code || !state || !storedState || !codeVerifier || state !== storedState) {
        return reply.redirect(`${env.WEB_URL}/login?error=google_oauth_failed`);
      }

      try {
        const tokens = await google.validateAuthorizationCode(code, codeVerifier);
        const googleUser = await fetchGoogleUserInfo(tokens.accessToken());
        if (!googleUser.email_verified) {
          // Google itself hasn't confirmed this account controls the email —
          // trusting it here would let an unverified address attach to (or
          // create) an account it doesn't actually own.
          return reply.redirect(`${env.WEB_URL}/login?error=google_email_unverified`);
        }
        // Google vouches for the address; the company decides who gets in.
        if (!emailIsAllowed(googleUser.email)) {
          return reply.redirect(`${env.WEB_URL}/login?error=email_domain`);
        }
        const user = await findOrCreateUserByEmail(
          googleUser.email,
          googleUser.name,
          googleUser.picture ?? null,
        );

        const session = await createSession(user.id);
        setSessionCookie(reply, session.id);

        return reply.redirect(`${env.WEB_URL}/`);
      } catch (err) {
        req.log.error(err);
        if (err instanceof OAuth2RequestError) {
          return reply.redirect(`${env.WEB_URL}/login?error=google_oauth_failed`);
        }
        return reply.redirect(`${env.WEB_URL}/login?error=google_oauth_failed`);
      }
    },
  );
}
