import { defineConfig, devices } from "@playwright/test";

// M7.10 production smoke test — runs against an already-running Canvas (no
// webServer), e.g. the real server right after a deploy:
//
//   SMOKE_BASE_URL=https://canvas.example.com pnpm --filter @canvas/e2e test:smoke
//
// It creates a "Smoke test" workspace and two smoke-*@example.com accounts
// (see DEPLOYMENT.md step 7 for cleaning them up afterwards).
export default defineConfig({
  testDir: "./smoke",
  testMatch: "**/*.smoke.ts",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "http://localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
