import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, storageOrigins } from "./csp";

const r2 = {
  S3_ENDPOINT: "https://acc123.r2.cloudflarestorage.com",
  S3_BUCKET: "canvas-prod",
  S3_FORCE_PATH_STYLE: false,
  WEB_URL: "https://canvas.trekuartista.com",
};

describe("storageOrigins", () => {
  it("covers R2's virtual-hosted bucket URLs", () => {
    expect(storageOrigins(r2)).toEqual([
      "https://acc123.r2.cloudflarestorage.com",
      "https://canvas-prod.acc123.r2.cloudflarestorage.com",
    ]);
  });

  it("is the storage host for Supabase Storage (path-style)", () => {
    expect(
      storageOrigins({
        S3_ENDPOINT: "https://abcdef.storage.supabase.co/storage/v1/s3",
        S3_BUCKET: "canvas-prod",
        S3_FORCE_PATH_STYLE: true,
      }),
    ).toEqual(["https://abcdef.storage.supabase.co"]);
  });

  it("is just the endpoint for path-style (local fake S3)", () => {
    expect(
      storageOrigins({
        S3_ENDPOINT: "http://localhost:9000",
        S3_BUCKET: "canvas-dev",
        S3_FORCE_PATH_STYLE: true,
      }),
    ).toEqual(["http://localhost:9000"]);
  });
});

describe("contentSecurityPolicy", () => {
  it("lets the SPA upload to R2 and report to Sentry, and upgrades to https", () => {
    const csp = contentSecurityPolicy({
      ...r2,
      VITE_SENTRY_DSN: "https://key@o1.ingest.de.sentry.io/42",
    });
    expect(csp.directives["connect-src"]).toEqual([
      "'self'",
      "https://acc123.r2.cloudflarestorage.com",
      "https://canvas-prod.acc123.r2.cloudflarestorage.com",
      "https://o1.ingest.de.sentry.io",
    ]);
    expect(csp.directives["img-src"]).toContain("blob:");
    expect(csp.directives["img-src"]).toContain("https://*.googleusercontent.com");
    expect(csp.directives["upgrade-insecure-requests"]).toEqual([]);
  });

  it("doesn't force https on a plain-http local run, and ignores a bad DSN", () => {
    const csp = contentSecurityPolicy({
      S3_ENDPOINT: "http://localhost:9000",
      S3_BUCKET: "canvas-dev",
      S3_FORCE_PATH_STYLE: true,
      WEB_URL: "http://localhost:3001",
      VITE_SENTRY_DSN: "not a url",
    });
    expect(csp.directives["upgrade-insecure-requests"]).toBeNull();
    expect(csp.directives["connect-src"]).toEqual(["'self'", "http://localhost:9000"]);
  });

  it("lets signed contract thumbnails, photos and PDF previews load from storage", () => {
    const csp = contentSecurityPolicy(r2);
    for (const origin of storageOrigins(r2)) {
      expect(csp.directives["img-src"]).toContain(origin);
      expect(csp.directives["frame-src"]).toContain(origin);
    }
  });
});
