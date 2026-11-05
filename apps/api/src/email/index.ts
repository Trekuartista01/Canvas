import { env } from "../env";
import { MockEmailClient } from "./mock-client";
import { SmtpEmailClient } from "./smtp-client";
import type { EmailClient } from "./types";

let client: EmailClient | undefined;

export function getEmailClient(): EmailClient {
  if (!client) {
    // Tests never send real email, even with a real key in a developer's .env.
    const isTestRun = env.E2E_TEST_HOOKS || Boolean(process.env.VITEST);
    client = env.SMTP_HOST && !isTestRun ? new SmtpEmailClient() : new MockEmailClient();
  }
  return client;
}

export * from "./types";
