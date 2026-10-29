import { db, schema } from "@canvas/db";
import { eq } from "drizzle-orm";
import { listActiveMemberIds } from "./membership";

// Shared by every notification-creating call site (comment @mentions,
// task assignment, urgent-priority broadcasts) — a bare insert against an
// existing `activity` row, same shape everywhere. Extracted from what were
// near-identical inline copies in comment.ts and friends.
export async function notifyUsers(activityId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await db.insert(schema.notifications).values(unique.map((userId) => ({ userId, activityId })));
}

// Every member of a workspace, optionally excluding the actor (who doesn't
// need telling about their own action) — used for workspace-wide
// broadcasts like a task newly flagged urgent.
export async function notifyWorkspace(
  activityId: string,
  workspaceId: string,
  excludeUserId?: string,
) {
  const members = await listActiveMemberIds(workspaceId);
  const userIds = members.filter((id) => id !== excludeUserId);
  await notifyUsers(activityId, userIds);
}

// Every active member whose people_role is 'operation_manager' (M7.1 —
// replaced the old is_operations_manager flag). Split out from
// notifyOperationsManagers so a caller notifying about several activities in
// the same workspace (e.g. task.bulkUpdate) can look this up once instead of
// re-querying membership per activity.
export async function getOperationsManagerIds(workspaceId: string): Promise<string[]> {
  return listActiveMemberIds(workspaceId, eq(schema.memberships.peopleRole, "operation_manager"));
}

// Used when a task reaches a done-kind status, same "who should hear about
// this" reasoning as notifyWorkspace but narrowed to a named role instead of
// everyone.
export async function notifyOperationsManagers(activityId: string, workspaceId: string) {
  const managerIds = await getOperationsManagerIds(workspaceId);
  await notifyUsers(activityId, managerIds);
}
