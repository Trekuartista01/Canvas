import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  // Non-AWS stores (Supabase Storage, R2): newer AWS SDKs attach CRC checksum headers/params to
  // every PutObject by default, including presigned URLs — the browser's
  // direct PUT then has to reproduce a checksum it never computed. Only send
  // checksums when an operation actually requires one.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// A throwaway S3-compatible server (CI's e2e job) starts empty, so the app
// creates the bucket and its CORS rule itself. Hosted storage (Supabase
// Storage in prod, DEPLOYMENT.md step 2; R2 also works) is never managed
// from here: the bucket is pre-created in its dashboard, along with any CORS
// rule it needs.
function isLocalEndpoint(endpoint: string) {
  return /localhost|127\.0\.0\.1/i.test(endpoint);
}

export async function ensureBucketExists() {
  if (!isLocalEndpoint(env.S3_ENDPOINT)) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch (err) {
      console.warn(
        `storage: bucket "${env.S3_BUCKET}" isn't reachable at ${env.S3_ENDPOINT} — create it in the storage dashboard and check the S3_* credentials:`,
        err instanceof Error ? err.message : err,
      );
    }
    return;
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }

  // Large-attachment uploads (attachment.presignUpload) PUT straight from
  // the browser to the bucket, bypassing the API — that only works if the
  // bucket itself allows cross-origin PUTs from the web app's origin.
  // Fastify's own CORS registration (index.ts) is unrelated; this is a
  // bucket-level policy the storage server enforces on direct requests.
  // Swallowed on failure so a server without PutBucketCors support doesn't
  // crash startup.
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: env.S3_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [env.WEB_URL],
              AllowedMethods: ["PUT", "GET"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch (err) {
    console.warn(
      "storage: bucket-level CORS not supported by this S3 endpoint, skipping (direct browser uploads need the server's own CORS config instead):",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string) {
  return s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

// Returns null if the object doesn't exist (a confirmUpload call for a PUT
// that never actually landed) rather than throwing — the caller treats
// "not there" as an ordinary validation failure, not a server error.
/**
 * Did the direct upload arrive with the Content-Type its presigned URL was
 * signed for? Supabase Storage (unlike AWS) doesn't enforce the signed type
 * on the PUT itself, so the confirm step checks it instead. Parameters
 * ("; charset=…") and case are ignored; a store that reports no type passes.
 */
export function uploadedTypeMatches(storedType: string | undefined, signedType: string) {
  if (!storedType) return true;
  const base = (t: string) => t.split(";")[0]!.trim().toLowerCase();
  return base(storedType) === base(signedType);
}

export async function headObject(key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  } catch {
    return null;
  }
}

// Direct browser-to-storage upload (attachment.presignUpload) — the one
// exception to M1.9's "no presigned URLs, the API streams every byte
// itself" decision, made specifically for multi-GB files (3D/video assets)
// that would otherwise have to be buffered whole in the API's memory by
// @fastify/multipart before ever reaching S3. Downloads are untouched:
// GET /uploads/:id still streams through the app with a permission check
// on every request, so the bucket still isn't reachable by the browser for
// reads. The PUT is signed with a fixed ContentType. AWS enforces it on
// the upload itself; Supabase Storage doesn't, so both confirm steps check
// the stored type with uploadedTypeMatches() and refuse (and delete) a
// file that arrived as a different type than was authorized.
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  );
}

// Server-to-external-provider only (the image-generation worker handing a
// source image to an ImageEngine adapter's edit() call) — not exposed to
// the browser. Distinct from M1.9's decision to stream every attachment
// byte through the app rather than issue presigned URLs, which was
// specifically about not exposing the bucket to the browser directly; this is a
// different boundary (server -> external API), where a short-lived
// presigned URL is the standard, simplest way to hand off image bytes.
export async function getPresignedUrl(
  key: string,
  expiresInSeconds = 300,
  // M7.6: set for browser downloads (contracts, company documents) — served
  // as an attachment under its original name instead of rendered inline.
  downloadFileName?: string,
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ...(downloadFileName
        ? {
            ResponseContentDisposition: `attachment; filename="${downloadFileName.replace(/["\\\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(downloadFileName)}`,
          }
        : {}),
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/** M7.10 health check: can we reach the bucket with these credentials? */
export async function bucketReachable(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}
