import { db, schema } from "@canvas/db";
import { TRPCError } from "@trpc/server";
import { and, eq, exists, sql, type SQL } from "drizzle-orm";
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
  // P8.9: anything scoped to a board also needs access to that board.
  if (opts?.spaceId && !(await canAccessBoard(user, workspaceId, opts.spaceId))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

/** P8.9 (spec §10): boards:manageAll reaches every board, others need a space_members row. */
export async function canAccessBoard(user: SessionUser, workspaceId: string, spaceId: string) {
  if (await canPeopleAction(user, workspaceId, "boards:manageAll")) return true;
  const member = await db.query.spaceMembers.findFirst({
    where: and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.spaceMembers.userId, user.id)),
  });
  return Boolean(member);
}

/**
 * For queries across boards, which must join spaces: the boards this person
 * may see, applied before anything is ranked or counted. Undefined means all.
 */
export async function visibleBoardsCondition(
  user: SessionUser,
  workspaceId: string,
): Promise<SQL | undefined> {
  if (await canPeopleAction(user, workspaceId, "boards:manageAll")) return undefined;
  return exists(
    db
      .select({ one: sql`1` })
      .from(schema.spaceMembers)
      .where(
        and(
          eq(schema.spaceMembers.spaceId, schema.spaces.id),
          eq(schema.spaceMembers.userId, user.id),
        ),
      ),
  );
}

/** Puts someone on a board, e.g. because a card there was just assigned to them. */
export async function addBoardMember(spaceId: string, userId: string, addedBy: string | null) {
  await db.insert(schema.spaceMembers).values({ spaceId, userId, addedBy }).onConflictDoNothing();
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
 * People actions (P8.1 roles). With `targetUserId`, resolves whether the
 * target is the caller themselves — the one target-level rule is "everyone
 * may see their own profile" (can()'s isSelf branch). There's no team
 * scoping any more: every allowed role sees the whole workspace.
 */
export async function assertCanPeople(
  user: SessionUser,
  workspaceId: string,
  action: PeopleAction,
  opts?: { targetUserId?: string },
) {
  const people = await getPeopleContext(workspaceId, user.id);
  let target: { isSelf: boolean } | undefined;
  if (opts?.targetUserId) {
    const targetMembership = await findMembership(workspaceId, opts.targetUserId);
    if (!targetMembership) throw new TRPCError({ code: "NOT_FOUND" });
    target = { isSelf: opts.targetUserId === user.id };
  }

  if (!can(user, action, { type: "people", peopleRole: people?.peopleRole ?? null, target })) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return people!;
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
