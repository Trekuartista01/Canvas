import { db, schema } from "@canvas/db";
import {
  PEOPLE_ROLE_LABELS,
  PRIVILEGED_PEOPLE_ROLES,
  type PeopleRole,
  type RequestablePeopleRole,
} from "@canvas/shared";
import { and, eq } from "drizzle-orm";
import { emailUsers } from "../email/send-email";
import { logActivity } from "./activity";
import { writeAudit } from "./audit";
import { listActiveMemberIdsWithRole, listHrUserIds } from "./membership";
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

/**
 * Someone joined through an invite that chose their role. Whoever invited them
 * made the decision, so it's recorded as theirs, with the same audit row and HR
 * notice as changing a role by hand (people.setRole).
 */
export async function announceInvitedRole(input: {
  workspaceId: string;
  invitedBy: string;
  userId: string;
  peopleRole: PeopleRole;
}) {
  const [person, inviter] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, input.userId) }),
    db.query.users.findFirst({ where: eq(schema.users.id, input.invitedBy) }),
  ]);
  const from = "employee";
  const activity = await logActivity(
    input.workspaceId,
    input.invitedBy,
    "person",
    input.userId,
    "person.role_changed",
    { from, to: input.peopleRole, name: person?.name ?? "" },
  );
  if (!PRIVILEGED_PEOPLE_ROLES.includes(input.peopleRole)) return;
  await writeAudit({
    workspaceId: input.workspaceId,
    actorId: input.invitedBy,
    action: "person.role_changed",
    entity: "person",
    entityId: input.userId,
    ip: null,
    payload: { from, to: input.peopleRole, viaInvite: true },
  });
  const hrIds = await listHrUserIds(input.workspaceId);
  await notifyUsers(activity.id, hrIds);
  void emailUsers(
    hrIds,
    "Canvas: a role was changed",
    `${inviter?.name ?? "Someone"} invited ${person?.name ?? "someone"}, who is now ${PEOPLE_ROLE_LABELS[input.peopleRole]}.`,
  );
}
