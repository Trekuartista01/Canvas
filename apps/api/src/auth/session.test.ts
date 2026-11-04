import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS, shouldRenewSession } from "./session-lifetime";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-04T09:00:00Z");
const expiresIn = (ms: number) => new Date(now.getTime() + ms);

describe("shouldRenewSession", () => {
  it("leaves a session used again the same day alone", () => {
    expect(shouldRenewSession(expiresIn(SESSION_TTL_MS), now)).toBe(false);
    expect(shouldRenewSession(expiresIn(SESSION_TTL_MS - DAY / 2), now)).toBe(false);
  });

  it("renews once it has been a day, so daily use never runs out", () => {
    expect(shouldRenewSession(expiresIn(SESSION_TTL_MS - DAY - 1), now)).toBe(true);
  });

  it("renews a session from before the lifetime grew", () => {
    expect(shouldRenewSession(expiresIn(30 * DAY), now)).toBe(true);
  });
});

describe("SESSION_TTL_MS", () => {
  it("stays inside the 400 days browsers allow a cookie", () => {
    expect(SESSION_TTL_MS).toBeLessThanOrEqual(400 * DAY);
  });
});
