import { db } from "@canvas/db";
import { workspaceAdminSchema } from "@canvas/shared";
import { sql } from "drizzle-orm";
import { getAiQuotaSnapshot } from "../../lib/ai-quota";
import { assertCan } from "../../lib/permissions";
import { redisConnection } from "../../queues/connection";
import { protectedProcedure, router } from "../trpc";

async function probeHealth(): Promise<{
  ok: boolean;
  checks: Record<string, "ok" | "error">;
}> {
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
  return { ok: Object.values(checks).every((v) => v === "ok"), checks };
}

export const adminRouter = router({
  // Same probes as GET /health, but gated so only workspace admins see them
  // in the Admin UI (the public /health route stays for load balancers).
  status: protectedProcedure.input(workspaceAdminSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "workspace:manage");
    return probeHealth();
  }),

  myAiQuota: protectedProcedure.input(workspaceAdminSchema).query(async ({ ctx, input }) => {
    // Admin page only — same owner/admin gate as status/backups/audit.
    await assertCan(ctx.user, input.workspaceId, "workspace:manage");
    return getAiQuotaSnapshot(ctx.user.id);
  }),

  backupGuidance: protectedProcedure.input(workspaceAdminSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "workspace:manage");
    return {
      hosting: "vm_pm2" as const,
      steps: [
        "The API and worker run under PM2 on the server (ecosystem.config.cjs); the database is Supabase.",
        "Nightly cron runs scripts/backup-db.sh: pg_dump → gzip → R2 bucket at backups/YYYY-MM-DD.dump.gz.",
        "The newest 14 daily backups are kept; older ones are deleted automatically.",
        "Uploaded files live in the same R2 bucket — enable R2 object versioning or sync it elsewhere with rclone.",
        "Quarterly restore drill: restore the latest dump into a scratch database and hit /health.",
      ],
      restoreHint:
        'gunzip -c 2026-01-31.dump.gz > db.dump; psql $DATABASE_URL -c "create extension if not exists vector"; pg_restore --no-owner -d $DATABASE_URL db.dump — a "schema public already exists" error is expected.',
    };
  }),
});
