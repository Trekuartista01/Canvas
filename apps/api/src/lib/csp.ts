/**
 * M7.10: the Content-Security-Policy the API sends with the built web app.
 * Helmet's default is `default-src 'self'`, which silently blocks things the
 * SPA genuinely does across origins — found by the production smoke test,
 * where every direct-to-R2 upload (task attachments, proof photos, leave
 * documents) failed:
 * - connect-src: the browser PUTs uploads straight to the storage bucket
 *   (path-style `host/bucket` or virtual-hosted `bucket.host`), and reports
 *   errors to Sentry when the web build has a DSN;
 * - img-src: Google profile pictures, and blob: previews (image downscaling);
 * - media-src: blob: (video frame extraction for clips);
 * - img-src + frame-src: P8.6 contract thumbnails, photos and PDF previews are
 *   5-minute signed links straight to the bucket.
 * Everything else stays 'self'.
 */
export interface CspEnv {
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_FORCE_PATH_STYLE: boolean;
  WEB_URL: string;
  VITE_SENTRY_DSN?: string;
}

/** Every origin a presigned storage URL can have for this endpoint + bucket. */
export function storageOrigins(
  env: Pick<CspEnv, "S3_ENDPOINT" | "S3_BUCKET" | "S3_FORCE_PATH_STYLE">,
) {
  const endpoint = new URL(env.S3_ENDPOINT);
  const origins = [endpoint.origin];
  if (!env.S3_FORCE_PATH_STYLE) {
    origins.push(`${endpoint.protocol}//${env.S3_BUCKET}.${endpoint.host}`);
  }
  return origins;
}

function sentryOrigin(dsn: string | undefined) {
  if (!dsn) return [];
  try {
    return [new URL(dsn).origin];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy(env: CspEnv) {
  const secure = env.WEB_URL.startsWith("https://");
  return {
    useDefaults: true,
    directives: {
      "connect-src": ["'self'", ...storageOrigins(env), ...sentryOrigin(env.VITE_SENTRY_DSN)],
      "img-src": [
        "'self'",
        "data:",
        "blob:",
        "https://*.googleusercontent.com",
        ...storageOrigins(env),
      ],
      "frame-src": ["'self'", ...storageOrigins(env)],
      "media-src": ["'self'", "blob:"],
      // Only over https — on a plain-http local run it would rewrite the
      // storage URLs to https and break uploads.
      "upgrade-insecure-requests": secure ? [] : null,
    },
  };
}
