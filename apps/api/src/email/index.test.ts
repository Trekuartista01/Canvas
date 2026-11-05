import { afterEach, describe, expect, it, vi } from "vitest";

async function clientWith(settings: Record<string, string>) {
  for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
  vi.resetModules();
  const { getEmailClient } = await import("./index");
  return getEmailClient().constructor.name;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// A real key in a developer's .env must never make a test send real email.
describe("getEmailClient", () => {
  it("never sends real email from a unit test", async () => {
    expect(await clientWith({ SMTP_HOST: "smtp.example.com" })).toBe("MockEmailClient");
  });

  it("never sends real email from an e2e run", async () => {
    expect(
      await clientWith({ VITEST: "", E2E_TEST_HOOKS: "true", SMTP_HOST: "smtp.example.com" }),
    ).toBe("MockEmailClient");
  });

  it("sends real email when a sender is set outside tests", async () => {
    expect(
      await clientWith({ VITEST: "", E2E_TEST_HOOKS: "false", SMTP_HOST: "smtp.example.com" }),
    ).toBe("SmtpEmailClient");
  });

  it("only logs when no sender is set", async () => {
    expect(await clientWith({ VITEST: "", E2E_TEST_HOOKS: "false", SMTP_HOST: "" })).toBe(
      "MockEmailClient",
    );
  });
});
