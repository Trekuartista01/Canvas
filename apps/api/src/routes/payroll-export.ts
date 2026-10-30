import { db, schema } from "@canvas/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getSessionUser } from "../auth/session";
import { logActivity } from "../lib/activity";
import { loadPayrollRows } from "../lib/payroll";
import { buildPayrollPdf, buildPayrollXlsx } from "../lib/payroll-export";
import { canPeopleAction } from "../lib/permissions";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// M7.7: the whole payroll table, decrypted, as Excel or PDF. A REST route
// for real download headers (like export.ts). payroll:view only; every
// export is an audit row.
export function registerPayrollExportRoutes(app: FastifyInstance) {
  app.get<{ Params: { workspaceId: string; format: string } }>(
    "/payroll-export/:workspaceId/payroll.:format",
    async (req, reply) => {
      const user = await getSessionUser(req);
      if (!user) return reply.code(401).send({ error: "Unauthorized" });
      const { workspaceId, format } = req.params;
      if (format !== "xlsx" && format !== "pdf")
        return reply.code(404).send({ error: "Not found" });
      if (!(await canPeopleAction(user, workspaceId, "payroll:view"))) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const workspace = await db.query.workspaces.findFirst({
        where: eq(schema.workspaces.id, workspaceId),
      });
      const rows = await loadPayrollRows(workspaceId, { reveal: true });
      await logActivity(workspaceId, user.id, "payroll", workspaceId, "payroll.exported", {
        format,
        rows: rows.length,
      });

      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const body =
        format === "xlsx"
          ? await buildPayrollXlsx(rows, workspace?.name ?? "")
          : Buffer.from(await buildPayrollPdf(rows, workspace?.name ?? "", now));
      reply.header("Content-Type", format === "xlsx" ? XLSX_TYPE : "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="payroll-${date}.${format}"`);
      reply.header("Cache-Control", "private, no-store");
      return reply.send(body);
    },
  );
}
