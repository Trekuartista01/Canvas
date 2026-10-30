import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth/session";
import { env } from "../env";
import { canPeopleAction } from "../lib/permissions";
import { computeEmployeeOfMonth } from "../lib/performance-data";

const eomSchema = z.object({
  workspaceId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

/**
 * E2E-only seams for scheduler jobs that otherwise run once a month.
 * Registered only when E2E_TEST_HOOKS is set (the Playwright webServer env);
 * env.ts refuses to start production with it on.
 */
export function registerTestHookRoutes(app: FastifyInstance) {
  if (!env.E2E_TEST_HOOKS) return;

  // M7.8: (re)compute one workspace's Employee of the Month for `month`.
  app.post("/test-hooks/employee-of-month", async (req, reply) => {
    const user = await getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const parsed = eomSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Bad request" });
    if (!(await canPeopleAction(user, parsed.data.workspaceId, "performance:view"))) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const row = await computeEmployeeOfMonth(parsed.data.workspaceId, parsed.data.month, {
      replace: true,
    });
    return reply.send({ ok: true, userId: row?.userId ?? null, score: row?.score ?? null });
  });
}
