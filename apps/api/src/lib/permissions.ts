import { db, schema } from "@canvas/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { PeopleAction, WorkspaceAction } from "../auth/can";
import { can } from "../auth/can";
import type { SessionUser } from "../auth/session";
import { findMembership, getMembershipContext, getPeopleContext } from "./membership";
import { getCustomRoleDeltas, getSpaceOverrideForMembership } from "./space-overrides";

/**
 * `opts.spaceId`, when passed, lets a Phase-6 space_permission_overrides row
 * decide the outcome outright for that one space — see can()'s
 * `spaceOverride` field. Omit it for actions with no space scope (most of
 * them); existing call sites are unaffected either way, since no override
 * rows exist unless an admin has explicitly created one for that space.
 */
export async function assertCan(
  user: SessionUser,
  workspaceId: string,
  action: WorkspaceAction,
  opts?: { spaceId?: string },
) {
  const membership = await getMembershipContext(workspaceId, user.id);
  const { role, customRoleId } = membership;
  const customRole = customRoleId ? await getCustomRoleDeltas(customRoleId) : null;
  const spaceOverride =
    opts?.spaceId && role
      ? await getSpaceOverrideForMembership(opts.spaceId, { role, customRoleId }, action)
      : null;

  if (!can(user, action, { type: "workspace", role, customRole, spaceOverride })) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

/**
 * For account-level resources with no single workspace to check against —
 * currently just custom roles (owned by their creator, visible in every
 * workspace that creator belongs to; see role.ts's update/delete). Passes
 * if the user currently holds `action` in at least one of their
 * memberships, so a creator who's since been demoted or removed from every
 * workspace loses standing here too, same as any other admin-tier action
 * would require — ownership alone (checked separately by the caller) isn't
 * enough on its own.
 */
export async function assertCanInAnyWorkspace(user: SessionUser, action: WorkspaceAction) {
  const memberships = await db.query.memberships.findMany({
    where: eq(schema.memberships.userId, user.id),
  });

  for (const membership of memberships) {
    // A deactivated member (M7.1) has no standing in that workspace.
    if (!(await findMembership(membership.workspaceId, user.id))?.active) continue;
    const customRole = membership.customRoleId
      ? await getCustomRoleDeltas(membership.customRoleId)
      : null;
    if (can(user, action, { type: "workspace", role: membership.role, customRole })) {
      return;
    }
  }

  throw new TRPCError({ code: "FORBIDDEN" });
}

/**
 * M7.1 People actions. With `targetUserId`, resolves the resource-level half
 * of the check — whether the target is the caller themselves or one of their
 * direct reports — so a staff manager only passes for their own team. Without
 * it, it's a list-level check: a staff manager passes, and the caller must
 * scope its query with teamScopeFor().
 */
export async function assertCanPeople(
  user: SessionUser,
  workspaceId: string,
  action: PeopleAction,
  opts?: { targetUserId?: string },
) {
  const people = await getPeopleContext(workspaceId, user.id);
  let target: { isSelf: boolean; isDirectReport: boolean } | undefined;
  if (opts?.targetUserId) {
    const targetMembership = await findMembership(workspaceId, opts.targetUserId);
    if (!targetMembership) throw new TRPCError({ code: "NOT_FOUND" });
    target = {
      isSelf: opts.targetUserId === user.id,
      isDirectReport: targetMembership.managerUserId === user.id,
    };
  }

  if (!can(user, action, { type: "people", peopleRole: people?.peopleRole ?? null, target })) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return people!;
}

/**
 * For a list-level team action the caller already passed: null means "the
 * whole workspace", otherwise only these members (a staff manager's direct
 * reports) may be shown.
 */
export async function teamScopeFor(workspaceId: string, userId: string, peopleRole: string) {
  if (peopleRole !== "staff_manager") return null;
  const reports = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        eq(schema.memberships.managerUserId, userId),
      ),
    );
  return reports.map((r) => r.userId);
}

/**
 * Any active (non-deactivated) member — for features every role uses on
 * their own data (daily reports, the holiday calendar).
 */
export async function requireActiveMember(user: SessionUser, workspaceId: string) {
  const people = await getPeopleContext(workspaceId, user.id);
  if (!people) throw new TRPCError({ code: "FORBIDDEN" });
  return people;
}

/** assertCanPeople as a boolean, for "may this caller see the edit controls?". */
export async function canPeopleAction(
  user: SessionUser,
  workspaceId: string,
  action: PeopleAction,
) {
  const people = await getPeopleContext(workspaceId, user.id);
  return can(user, action, { type: "people", peopleRole: people?.peopleRole ?? null });
}
