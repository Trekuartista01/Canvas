import { db, schema } from "@canvas/db";
import { isIP } from "node:net";

export interface AuditEntry {
  workspaceId: string;
  /** Null for system actions (the seed script, scheduled jobs). */
  actorId: string | null;
  /** e.g. "payroll.viewed", "person.role_changed". */
  action: string;
  entity: string;
  entityId?: string | null;
  ip?: string | null;
  payload?: object;
}

/**
 * P8.1 (docs/hr-ops-spec.md §1): records a view, download, create, update or
 * delete of HR data, or a role change, in `audit_log`. Only HR reads it
 * (audit.list). `ip` comes from the request (req.ip — trustProxy only
 * believes the loopback hop, so it's Caddy's X-Forwarded-For in production).
 */
export async function writeAudit(entry: AuditEntry) {
  await db.insert(schema.auditLog).values({
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    // An `inet` column rejects anything that isn't an address.
    ip: entry.ip && isIP(entry.ip) ? entry.ip : null,
    payloadJson: entry.payload ?? null,
  });
}

// Activity entity types that are HR data. The Admin page's workspace feed
// (activity.listWorkspace, workspace:manage) leaves them out — HR's own
// trail is audit_log. Role changes ("person.role_changed") stay visible:
// they're admin's own action.
export const HR_ACTIVITY_ENTITY_TYPES = [
  "payroll",
  "contract",
  "leave_request",
  "leave_balance",
  "person",
] as const;
