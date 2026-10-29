import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: isCI ? 1 : 0,
  reporter: isCI ? "line" : "html",
  use: {
    baseURL: "http://localhost:5183",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Both dev servers are started fresh in CI; locally, reuse whatever's
  // already running (e.g. from `pnpm dev`) to keep iteration fast.
  webServer: [
    {
      // API + BullMQ worker together — Brain chat (and image jobs) need the
      // worker process. Health-check the API; the worker shares the same
      // startup path and is up by the time /health responds. Launched via a
      // Node script rather than `sh -c` so it also works on Windows.
      command: "node scripts/start-api.mjs",
      url: "http://localhost:3001/health",
      reuseExistingServer: !isCI,
      timeout: 30_000,
      // M3.5: a fast scheduler tick so the recurring-task/reminder spec
      // doesn't wait a real day/week/month for a recurrence to become due.
      // M3.9: same idea for the digest interval — a new user's cursor
      // starts null (always due on the first tick regardless of this
      // value), but a short interval also lets the spec observe a second
      // digest cycle without waiting a real day.
      // M5.6: points the GitHub PR-link fetch at a local mock server the
      // integrations spec starts on this fixed port (before it triggers a
      // fetch), instead of ever calling the real GitHub API — same
      // testability-seam idea as SCHEDULER_TICK_MS/DIGEST_INTERVAL_MS.
      // 2026-07-29: force Brain/Generate onto their Mock clients regardless
      // of whatever real keys a developer's own .env has configured — a
      // real OPENAI_API_KEY made every e2e run that touches Brain chat or
      // image generation a real, billed API call, which e2e must never do.
      // 2026-08-04: every parallel worker signs up/logs in from the same
      // localhost IP, so the app's production-appropriate auth rate limit
      // (20 signups+logins/min/IP) starves a multi-worker run of its own
      // credential-stuffing protection — root-caused via a real 5-worker
      // repro that failed 27/53 specs, 23 of them on the literal "Too many
      // attempts" error at signUp(). Raised, not disabled, so a genuine
      // runaway retry loop in a spec still gets caught eventually.
      // 2026-08-04: the webhook (M5.4) and Slack-notify (M5.6) specs each
      // stand in a real receiver with a local `http.createServer` on
      // 127.0.0.1 — safe-outbound-url.ts's SSRF guard blocks every private
      // address unconditionally, which silently broke both specs' actual
      // delivery assertion the moment that guard was added (2026-07-29).
      // Found via the same 5-worker repro as the auth-rate-limit fix above:
      // once that noisier failure mode was gone, these two were the only
      // consistent (not flaky) failures left in a 38-spec batch.
      // Only takes effect when this webServer entry actually spawns a fresh
      // process (reuseExistingServer skips it if one's already listening —
      // restart the dev server, or run with CI=1, to pick this up locally).
      env: {
        SCHEDULER_TICK_MS: "3000",
        DIGEST_INTERVAL_MS: "3000",
        GITHUB_API_BASE_URL: "http://127.0.0.1:4011",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GEMINI_API_KEY: "",
        AUTH_RATE_LIMIT_MAX: "1000",
        AUTH_EMAIL_RATE_LIMIT_MAX: "1000",
        SAFE_OUTBOUND_ALLOW_PRIVATE: "true",
      },
    },
    {
      command: "pnpm --filter @canvas/web dev",
      url: "http://localhost:5183",
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
  ],
});
