import { describe, expect, it } from "vitest";
import {
  backupSizeFinding,
  configFindings,
  corsFinding,
  migrationFinding,
  nodeVersionFinding,
  pgDumpFinding,
  pgMajor,
} from "./preflight";

const good = {
  WEB_URL: "https://canvas.trekuartista.com",
  DATABASE_URL: "postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
  REDIS_URL: "redis://:abc123@127.0.0.1:6379",
  S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: "false",
  SMTP_HOST: "smtp.example.com",
  EMAIL_FROM: "Canvas <no-reply@trekuartista.com>",
  ANTHROPIC_API_KEY: "sk-x",
};
const levels = (env: Record<string, string | undefined>) =>
  Object.fromEntries(configFindings(env).map((f) => [f.check, f.level]));

describe("configFindings", () => {
  it("passes a correct production config (Google sign-in optional)", () => {
    const findings = configFindings(good);
    expect(findings.filter((f) => f.level === "fail")).toEqual([]);
    expect(levels(good)["Google sign-in"]).toBe("warn");
  });

  it("catches the usual mistakes", () => {
    expect(levels({ ...good, WEB_URL: "http://canvas.trekuartista.com" }).WEB_URL).toBe("fail");
    expect(levels({ ...good, WEB_URL: "https://canvas.trekuartista.com/" }).WEB_URL).toBe("warn");
    expect(
      levels({ ...good, DATABASE_URL: good.DATABASE_URL.replace(":5432", ":6543") }).DATABASE_URL,
    ).toBe("fail");
    expect(levels({ ...good, REDIS_URL: "redis://127.0.0.1:6379" }).REDIS_URL).toBe("warn");
    expect(levels({ ...good, S3_ENDPOINT: "http://localhost:9000" }).S3_ENDPOINT).toBe("fail");
    expect(levels({ ...good, S3_REGION: "us-east-1" }).S3_REGION).toBe("warn");
    expect(levels({ ...good, EMAIL_FROM: "Canvas <notifications@canvas.local>" }).EMAIL_FROM).toBe(
      "fail",
    );
    expect(levels({ ...good, SMTP_HOST: undefined }).SMTP).toBe("warn");
  });

  it("requires the Google redirect to match WEB_URL when Google sign-in is on", () => {
    const google = { ...good, GOOGLE_CLIENT_ID: "id" };
    expect(
      levels({
        ...google,
        GOOGLE_REDIRECT_URI: "https://canvas.trekuartista.com/auth/google/callback",
      })["Google sign-in"],
    ).toBe("ok");
    expect(
      levels({ ...google, GOOGLE_REDIRECT_URI: "http://localhost:3001/auth/google/callback" })
        .GOOGLE_REDIRECT_URI,
    ).toBe("fail");
  });
});

describe("versions", () => {
  it("needs Node 22.13+", () => {
    expect(nodeVersionFinding("v22.13.0").level).toBe("ok");
    expect(nodeVersionFinding("v24.1.0").level).toBe("ok");
    expect(nodeVersionFinding("v22.12.9").level).toBe("fail");
    expect(nodeVersionFinding("v20.18.0").level).toBe("fail");
  });

  it("reads Postgres majors and compares pg_dump to the server", () => {
    expect(pgMajor("PostgreSQL 17.4 on aarch64-unknown-linux-gnu")).toBe(17);
    expect(pgMajor("pg_dump (PostgreSQL) 16.9 (Ubuntu 16.9-0ubuntu0.24.04.1)")).toBe(16);
    expect(pgDumpFinding("PostgreSQL 17.4", "pg_dump (PostgreSQL) 17.5").level).toBe("ok");
    expect(pgDumpFinding("PostgreSQL 17.4", "pg_dump (PostgreSQL) 16.9").level).toBe("fail");
    expect(pgDumpFinding("PostgreSQL 17.4", null).detail).toContain("postgresql-client-17");
  });
});

describe("migrationFinding", () => {
  it("compares applied migrations with the code's", () => {
    expect(migrationFinding(64, 64).level).toBe("ok");
    expect(migrationFinding(64, 60).detail).toContain("pnpm db:migrate");
    expect(migrationFinding(60, 64).level).toBe("warn");
  });
});

describe("configFindings — Supabase Storage", () => {
  const supabase = {
    ...good,
    S3_ENDPOINT: "https://abcdef.storage.supabase.co/storage/v1/s3",
    S3_REGION: "eu-west-3",
    S3_FORCE_PATH_STYLE: "true",
  };

  it("accepts the Supabase Storage S3 endpoint with path-style and its region", () => {
    expect(
      configFindings(supabase).filter((f) => f.level !== "ok" && f.check.startsWith("S3")),
    ).toEqual([]);
    expect(configFindings(supabase).find((f) => f.check === "S3_ENDPOINT")?.detail).toMatch(
      /Supabase Storage/,
    );
  });

  it("requires path-style and a real region", () => {
    expect(levels({ ...supabase, S3_FORCE_PATH_STYLE: "false" }).S3_FORCE_PATH_STYLE).toBe("fail");
    expect(levels({ ...supabase, S3_REGION: "auto" }).S3_REGION).toBe("warn");
  });
});

describe("backupSizeFinding", () => {
  const MB = 1024 * 1024;
  it("is fine with no backups or a small one", () => {
    expect(backupSizeFinding(null, 50 * MB).level).toBe("ok");
    expect(backupSizeFinding(3 * MB, 50 * MB).detail).toBe("newest is 3.0 MB");
  });
  it("warns past 80% of the per-file limit, and never without one", () => {
    expect(backupSizeFinding(41 * MB, 50 * MB).level).toBe("warn");
    expect(backupSizeFinding(400 * MB, null).level).toBe("ok");
  });
});

describe("corsFinding", () => {
  const origin = "https://canvas.trekuartista.com";
  it("accepts the origin or *, with PUT", () => {
    expect(
      corsFinding(
        origin,
        200,
        new Headers({
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, PUT",
        }),
      ).level,
    ).toBe("ok");
    expect(
      corsFinding(origin, 204, new Headers({ "access-control-allow-origin": "*" })).level,
    ).toBe("ok");
  });

  it("flags a missing or wrong rule", () => {
    expect(corsFinding(origin, 403, new Headers()).level).toBe("fail");
    expect(
      corsFinding(
        origin,
        200,
        new Headers({ "access-control-allow-origin": "http://localhost:5183" }),
      ).detail,
    ).toContain("localhost");
    expect(
      corsFinding(
        origin,
        200,
        new Headers({
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET",
        }),
      ).level,
    ).toBe("fail");
  });
});
