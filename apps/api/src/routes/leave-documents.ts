import { db, schema } from "@canvas/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getSessionUser } from "../auth/session";
import { sanitizeForHeader } from "../lib/filename";
import { canViewLeaveOf } from "../lib/leave";
import { buildLeaveDocumentPdf } from "../lib/leave-pdf";
import { findMembership } from "../lib/membership";

// M7.5: a leave confirmation PDF for an approved request. A plain REST route
// (not tRPC) for the same reason as export.ts — a download needs real
// Content-Type/Content-Disposition headers.
export function registerLeaveDocumentRoutes(app: FastifyInstance) {
  app.get<{ Params: { leaveRequestId: string } }>(
    "/leave-documents/:leaveRequestId/confirmation.pdf",
    async (req, reply) => {
      const user = await getSessionUser(req);
      if (!user) return reply.code(401).send({ error: "Unauthorized" });

      const request = await db.query.leaveRequests.findFirst({
        where: eq(schema.leaveRequests.id, req.params.leaveRequestId),
      });
      if (!request) return reply.code(404).send({ error: "Not found" });
      if (!(await canViewLeaveOf(user, request.workspaceId, request.userId))) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      if (request.status !== "approved") {
        return reply.code(409).send({ error: "Only approved leave has a confirmation" });
      }

      const [workspace, employee, approver, membership] = await Promise.all([
        db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, request.workspaceId) }),
        db.query.users.findFirst({ where: eq(schema.users.id, request.userId) }),
        request.decidedBy
          ? db.query.users.findFirst({ where: eq(schema.users.id, request.decidedBy) })
          : null,
        findMembership(request.workspaceId, request.userId),
      ]);
      const profile = membership
        ? await db.query.employeeProfiles.findFirst({
            where: eq(schema.employeeProfiles.membershipId, membership.id),
          })
        : null;

      const pdf = await buildLeaveDocumentPdf({
        workspaceName: workspace?.name ?? "",
        employeeName: employee?.name ?? "",
        jobTitle: profile?.jobTitle ?? null,
        type: request.type,
        startDate: request.startDate,
        endDate: request.endDate,
        workingDays: request.workingDays,
        reason: request.reason,
        approverName: approver?.name ?? null,
        decidedAt: request.decidedAt,
        recordedByHr: request.recordedBy !== null,
        requestId: request.id,
        generatedAt: new Date(),
      });

      const fileName = sanitizeForHeader(
        `leave-${employee?.name ?? "employee"}-${request.startDate}.pdf`.replace(/\s+/g, "-"),
      );
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
      reply.header("Cache-Control", "private, no-store");
      return reply.send(Buffer.from(pdf));
    },
  );
}
