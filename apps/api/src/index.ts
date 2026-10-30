import "./load-env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { db } from "@canvas/db";
import { env } from "./env";
import { initSentry, Sentry } from "./lib/sentry";
import { ensureBucketExists } from "./lib/storage";
import { redisConnection } from "./queues/connection";
import { registerAiReferenceRoutes } from "./routes/ai-references";
import { registerAttachmentRoutes } from "./routes/attachments";
import { registerAuthRoutes } from "./routes/auth";
import { registerAvatarRoutes } from "./routes/avatars";
import { registerBrainRealtimeRoutes } from "./routes/brain-realtime";
import { registerCopyGenerationRealtimeRoutes } from "./routes/copy-generation-realtime";
import { registerDocRealtimeRoutes } from "./routes/doc-realtime";
import { registerExportRoutes } from "./routes/export";
import { registerImageAssetRealtimeRoutes } from "./routes/image-asset-realtime";
import { registerImageAssetRoutes } from "./routes/image-assets";
import { registerLeaveDocumentRoutes } from "./routes/leave-documents";
import { registerPayrollExportRoutes } from "./routes/payroll-export";
import { registerTestHookRoutes } from "./routes/test-hooks";
import { registerRealtimeRoutes } from "./routes/realtime";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/router";

initSentry("api");

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type { AppRouter } from "./trpc/router";

// tRPC's fastify adapter batches every query fired in one render pass into
// a single GET whose route param is the comma-joined list of procedure
// names (e.g. "checklist.list,tag.list,customField.values.listForTask,...").
// Fastify's router default (100 chars) is sized for normal route params,
// not this — the task detail panel alone now fires 8+ queries on mount,
// so a 100-char cap here surfaces as an opaque 414 with no server-side
// error log (the request never reaches the tRPC handler at all).
const app = Fastify({
  logger: true,
  // Required behind a TLS terminator so req.protocol / hostname (and
  // req.ip, for rate limiting) reflect the client rather than the internal hop.
  trustProxy: true,
  routerOptions: { maxParamLength: 5000 },
});

// This is a pure JSON/binary API (no HTML views of its own), but two of its
// own routes serve arbitrary user-uploaded bytes (attachments, image-assets
// — see lib/mime-safety.ts's inline-vs-download content-type guard). Helmet
// is the second, independent layer: X-Frame-Options stops any of those
// responses from being framed by an external site, and the default CSP/
// nosniff/HSTS headers are standard baseline hardening even though most
// responses here are JSON. crossOriginEmbedderPolicy is off — this API is
// never embedded as a cross-origin subresource of another origin's COEP'd
// page, and leaving it on has no benefit here while being a common source
// of breakage for exactly this kind of cross-origin file-serving route.
await app.register(helmet, { crossOriginEmbedderPolicy: false });
await app.register(cors, { origin: env.WEB_URL, credentials: true });
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
await app.register(websocket);

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

registerAuthRoutes(app);
registerAttachmentRoutes(app);
registerAvatarRoutes(app);
registerImageAssetRoutes(app);
registerAiReferenceRoutes(app);
registerExportRoutes(app);
registerLeaveDocumentRoutes(app);
registerPayrollExportRoutes(app);
registerTestHookRoutes(app);
registerRealtimeRoutes(app);
registerBrainRealtimeRoutes(app);
registerImageAssetRealtimeRoutes(app);
registerCopyGenerationRealtimeRoutes(app);
registerDocRealtimeRoutes(app);

// Single-origin prod deploy (see ecosystem.config.cjs / DEPLOYMENT.md): this API server
// also serves apps/web's built SPA, so there's one public URL and no
// cross-site cookie/CORS story to get right. `pnpm build` (turbo) builds
// apps/web/dist as a sibling of this file's own build output
// (apps/api/dist/index.js -> ../../web/dist). Dev keeps using Vite's own
// dev server instead — apps/web/dist won't exist there, so this is a no-op.
if (process.env.NODE_ENV === "production") {
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  await app.register(staticFiles, { root: webDist });
  // @fastify/static's own not-found fallback (wildcard: true, the default)
  // only fires for unmatched GET requests that don't look like a static
  // asset path, which is exactly what a client-side route (e.g.
  // /workspace/abc/list/def) is — every real API route above already has
  // its own handler and is matched before Fastify ever reaches this.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET") return reply.sendFile("index.html", webDist);
    reply.code(404).send({ error: "not found" });
  });
}

// Captures unhandled route errors when SENTRY_DSN is set (no-op otherwise).
Sentry.setupFastifyErrorHandler(app);

app.get("/health", async (_req, reply) => {
  const checks: Record<string, "ok" | "error"> = { api: "ok" };

  try {
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  try {
    const pong = await redisConnection.ping();
    checks.redis = pong === "PONG" ? "ok" : "error";
  } catch {
    checks.redis = "error";
  }

  const ready = Object.values(checks).every((v) => v === "ok");
  return reply.code(ready ? 200 : 503).send({ ok: ready, checks });
});

await ensureBucketExists();

app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`api listening on :${env.API_PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
