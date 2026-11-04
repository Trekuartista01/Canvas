import { db, schema } from "@canvas/db";
import { PEOPLE_ROLE_LABELS, type RequestablePeopleRole } from "@canvas/shared";
import { and, eq } from "drizzle-orm";
import { emailUsers } from "../email/send-email";
import { logActivity } from "./activity";
import { listActiveMemberIdsWithRole } from "./membership";
import { notifyUsers } from "./notify";

/**
 * Someone joining through an invite says which role they hold. It grants
 * nothing: sign-up is open to whoever has the link, so it stays a request until
 * an Admin approves it (people.decideRoleRequest). Until then they're Employee.
 */
export async function recordRoleRequest(
  workspaceId: string,
  userId: string,
  requested: RequestablePeopleRole,
) {
  await db
    .update(schema.memberships)
    .set({ requestedPeopleRole: requested, roleRequestedAt: new Date() })
    .where(
      and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
    );
  const person = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const activity = await logActivity(
    workspaceId,
    userId,
    "person",
    userId,
    "person.role_requested",
    { requested, name: person?.name ?? "" },
  );
  const admins = await listActiveMemberIdsWithRole(workspaceId, "admin");
  await notifyUsers(activity.id, admins);
  void emailUsers(
    admins,
    "Canvas: a role request is waiting",
    `${person?.name ?? "Someone"} asked to be ${PEOPLE_ROLE_LABELS[requested]}. Approve or decline it in Directory.`,
  );
}
