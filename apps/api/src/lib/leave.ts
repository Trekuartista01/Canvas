import { db, schema } from "@canvas/db";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { can, type PeopleAction } from "../auth/can";
import type { SessionUser } from "../auth/session";
import { computeVacationBalance, yearOf, type LeaveLike } from "./leave-balance";
import { getPeopleContext, listHrUserIds } from "./membership";
import { assertCanPeople } from "./permissions";
import { PRIVATE_PREFIXES } from "./private-upload";

export async function loadLeaveRequests(workspaceId: string, userId: string): Promise<LeaveLike[]> {
  return db
    .select({
      id: schema.leaveRequests.id,
      type: schema.leaveRequests.type,
      status: schema.leaveRequests.status,
      startDate: schema.leaveRequests.startDate,
      endDate: schema.leaveRequests.endDate,
      workingDays: schema.leaveRequests.workingDays,
    })
    .from(schema.leaveRequests)
    .where(
      and(
        eq(schema.leaveRequests.workspaceId, workspaceId),
        eq(schema.leaveRequests.userId, userId),
      ),
    );
}

export async function findBalanceRow(workspaceId: string, userId: string, year: number) {
  return db.query.leaveBalances.findFirst({
    where: and(
      eq(schema.leaveBalances.workspaceId, workspaceId),
      eq(schema.leaveBalances.userId, userId),
      eq(schema.leaveBalances.year, year),
    ),
  });
}

async function defaultVacationDays(workspaceId: string) {
  const workspace = await db.query.workspaces.findFirst({
    where: eq(schema.workspaces.id, workspaceId),
  });
  return workspace?.defaultVacationDays ?? 20;
}

/**
 * The member's vacation balance for `year`. No balance row yet means the
 * workspace default and nothing carried over (the rollover job hasn't run
 * for them, or they're new).
 */
export async function getVacationBalance(
  workspaceId: string,
  userId: string,
  year: number,
  requests?: LeaveLike[],
) {
  const [row, fallback, all] = await Promise.all([
    findBalanceRow(workspaceId, userId, year),
    defaultVacationDays(workspaceId),
    requests ?? loadLeaveRequests(workspaceId, userId),
  ]);
  return computeVacationBalance({
    year,
    entitlementDays: row?.entitlementDays ?? fallback,
    carriedOverDays: row?.carriedOverDays ?? 0,
    requests: all.filter((r) => yearOf(r.startDate) === year),
  });
}

/** May `user` take `action` over `targetUserId`'s leave? Never over their own. */
export async function canActOnLeaveOf(
  user: SessionUser,
  workspaceId: string,
  targetUserId: string,
  action: PeopleAction,
) {
  if (targetUserId === user.id) return false;
  try {
    await assertCanPeople(user, workspaceId, action, { targetUserId });
    return true;
  } catch {
    return false;
  }
}

export async function assertCanActOnLeaveOf(
  user: SessionUser,
  workspaceId: string,
  targetUserId: string,
  action: PeopleAction,
) {
  if (targetUserId === user.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Someone else has to decide on your own leave",
    });
  }
  await assertCanPeople(user, workspaceId, action, { targetUserId });
}

/** The employee themselves, or anyone who may approve their leave. */
export async function canViewLeaveOf(user: SessionUser, workspaceId: string, targetUserId: string) {
  if (targetUserId === user.id) return Boolean(await getPeopleContext(workspaceId, user.id));
  return canActOnLeaveOf(user, workspaceId, targetUserId, "leave:approve");
}

/**
 * Whose leave the viewer may see details of in list views: null = everyone
 * (HR), otherwise just yourself.
 */
export async function leaveScopeFor(user: SessionUser, workspaceId: string) {
  const people = await getPeopleContext(workspaceId, user.id);
  if (!people) return [];
  return can(user, "leave:approve", { type: "people", peopleRole: people.peopleRole })
    ? null
    : [user.id];
}

/**
 * Who hears about a new leave request: every HR user except the requester.
 * Nobody else — not the owner or admin — even when there's no HR yet
 * (spec §1, "no admin bypass").
 */
export async function leaveApproverIds(workspaceId: string, requesterId: string) {
  return (await listHrUserIds(workspaceId)).filter((id) => id !== requesterId);
}

/**
 * Leave documents (doctor's notes) are attachments with no task or comment,
 * so the workspace-wide attachment:view check isn't enough: only the
 * employee and their approvers — or, before it's linked to a request, the
 * uploader — may download one. Returns null for a non-leave attachment.
 */

export async function canViewLeaveDocument(
  user: SessionUser,
  attachment: { id: string; workspaceId: string; uploaderId: string; fileKey: string | null },
): Promise<boolean | null> {
  // AI references etc. are task-less attachments too — the key prefix is
  // what marks a leave document.
  if (!attachment.fileKey?.startsWith(PRIVATE_PREFIXES.leave)) return null;
  const linked = await db
    .select({ userId: schema.leaveRequests.userId })
    .from(schema.leaveRequests)
    .where(inArray(schema.leaveRequests.documentAttachmentId, [attachment.id]))
    .limit(1);
  const request = linked[0];
  // Not attached to a request yet: only whoever uploaded it.
  if (!request) return attachment.uploaderId === user.id;
  return canViewLeaveOf(user, attachment.workspaceId, request.userId);
}
