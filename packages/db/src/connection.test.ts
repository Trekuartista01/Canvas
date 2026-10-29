import { describe, expect, it } from "vitest";
import { DEFAULT_POOL_MAX, pgPoolConfig } from "./connection";

const SUPABASE_URL =
  "postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

describe("pgPoolConfig", () => {
  it("disables TLS for a local database", () => {
    const config = pgPoolConfig({ DATABASE_URL: "postgres://canvas:canvas@localhost:5432/canvas" });
    expect(config.ssl).toBe(false);
    expect(config.max).toBe(DEFAULT_POOL_MAX);
  });

  it("falls back to the local dev database when DATABASE_URL is unset", () => {
    const config = pgPoolConfig({});
    expect(config.connectionString).toContain("localhost:5432/canvas");
    expect(config.ssl).toBe(false);
  });

  it("enables TLS without chain verification for a remote host with no CA", () => {
    const config = pgPoolConfig({ DATABASE_URL: SUPABASE_URL });
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("verifies against SUPABASE_CA_CERT when provided", () => {
    const pem = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
    const config = pgPoolConfig({ DATABASE_URL: SUPABASE_URL, SUPABASE_CA_CERT: pem });
    expect(config.ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
  });

  it("reads SUPABASE_CA_CERT as a file path when it isn't PEM text", () => {
    const config = pgPoolConfig(
      { DATABASE_URL: SUPABASE_URL, SUPABASE_CA_CERT: "/etc/canvas/prod-ca.crt" },
      (path) => `pem from ${path}`,
    );
    expect(config.ssl).toEqual({
      ca: "pem from /etc/canvas/prod-ca.crt",
      rejectUnauthorized: true,
    });
  });

  it("strips sslmode from the URL so it can't override the explicit ssl config", () => {
    const config = pgPoolConfig({
      DATABASE_URL: `${SUPABASE_URL}?sslmode=require&application_name=x`,
    });
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).toContain("application_name=x");
  });

  it("uses DB_POOL_MAX when it's a positive integer, else the default", () => {
    expect(pgPoolConfig({ DB_POOL_MAX: "3" }).max).toBe(3);
    expect(pgPoolConfig({ DB_POOL_MAX: "0" }).max).toBe(DEFAULT_POOL_MAX);
    expect(pgPoolConfig({ DB_POOL_MAX: "lots" }).max).toBe(DEFAULT_POOL_MAX);
  });
});
