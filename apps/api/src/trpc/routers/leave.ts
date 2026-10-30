import { db, schema } from "@canvas/db";
import {
  confirmLeaveDocumentSchema,
  decideLeaveSchema,
  leaveBalanceSchema,
  leaveCalendarSchema,
  leaveRequestIdSchema,
  leaveTeamSchema,
  presignLeaveDocumentSchema,
  previewLeaveSchema,
  recordLeaveSchema,
  requestLeaveSchema,
  setDefaultVacationDaysSchema,
  setLeaveBalanceSchema,
  type LeaveType,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { SessionUser } from "../../auth/session";
import { logActivity } from "../../lib/activity";
import { sanitizeFilenameForKey } from "../../lib/filename";
import {
  LEAVE_DOCUMENT_KEY_PREFIX,
  assertCanActOnLeaveOf,
  findBalanceRow,
  getVacationBalance,
  leaveApproverIds,
  leaveScopeFor,
  loadLeaveRequests,
} from "../../lib/leave";
import { approvalBlocker, validateLeaveRequest, yearOf } from "../../lib/leave-balance";
import { activeMembershipCondition, getMembershipRole } from "../../lib/membership";
import { notifyUsers } from "../../lib/notify";
import { assertCanPeople, canPeopleAction, requireActiveMember } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import { getPresignedUploadUrl, headObject } from "../../lib/storage";
import { countWorkingDays } from "../../lib/working-days";
import { protectedProcedure, router } from "../trpc";

type LeaveInput = { type: LeaveType; startDate: string; endDate: string };

/** Working days + the reason it can't be requested (null = fine), for `userId`. */
async function checkLeave(workspaceId: string, userId: string, input: LeaveInput) {
  const workingDays =
    input.endDate < input.startDate
      ? 0
      : await countWorkingDays(workspaceId, input.startDate, input.endDate);
  const existing = await loadLeaveRequests(workspaceId, userId);
  const balance = await getVacationBalance(workspaceId, userId, yearOf(input.startDate), existing);
  const problem = validateLeaveRequest({ ...input, workingDays, balance, existing });
  return { workingDays, balance, problem };
}

async function requireLeaveRequest(id: string) {
  const request = await db.query.leaveRequests.findFirst({
    where: eq(schema.leaveRequests.id, id),
  });
  if (!request) throw new TRPCError({ code: "NOT_FOUND" });
  return request;
}

// The document must be an unlinked leave document this workspace's user uploaded.
async function assertUsableDocument(
  workspaceId: string,
  uploaderId: string,
  attachmentId?: string,
) {
  if (!attachmentId) return;
  const attachment = await db.query.attachments.findFirst({
    where: eq(schema.attachments.id, attachmentId),
  });
  const linked = await db.query.leaveRequests.findFirst({
    where: eq(schema.leaveRequests.documentAttachmentId, attachmentId),
  });
  if (
    !attachment ||
    attachment.workspaceId !== workspaceId ||
    attachment.uploaderId !== uploaderId ||
    !attachment.fileKey?.startsWith(LEAVE_DOCUMENT_KEY_PREFIX) ||
    linked
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That document can't be attached" });
  }
}

async function publishLeave(workspaceId: string, id: string, kind: "created" | "updated") {
  await publish(workspaceId, { entity: "leave", id, workspaceId, kind });
}

function activityPayload(request: {
  userId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  workingDays: number;
}) {
  return {
    userId: request.userId,
    type: request.type,
    startDate: request.startDate,
    endDate: request.endDate,
    workingDays: request.workingDays,
  };
}

async function namesById(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(userIds)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function assertActiveTarget(workspaceId: string, userId: string) {
  if (!(await getMembershipRole(workspaceId, userId))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Not an active member" });
  }
}

async function decorate<
  T extends { userId: string; decidedBy: string | null; recordedBy: string | null },
>(rows: T[]) {
  const names = await namesById(
    rows.flatMap((r) => [r.userId, r.decidedBy, r.recordedBy]).filter((id): id is string => !!id),
  );
  return rows.map((r) => ({
    ...r,
    userName: names.get(r.userId) ?? "",
    decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
    recordedByName: r.recordedBy ? (names.get(r.recordedBy) ?? null) : null,
  }));
}

async function access(user: SessionUser, workspaceId: string) {
  const [canApprove, canRecord] = await Promise.all([
    canPeopleAction(user, workspaceId, "leave:approve"),
    canPeopleAction(user, workspaceId, "leave:recordForOthers"),
  ]);
  return { canApprove, canRecord };
}

export const leaveRouter = router({
  // My leave page: balance for `year`, all my requests, what else I may do.
  mine: protectedProcedure.input(leaveBalanceSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const requests = await db
      .select()
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.workspaceId, input.workspaceId),
          eq(schema.leaveRequests.userId, ctx.user.id),
        ),
      )
      .orderBy(desc(schema.leaveRequests.startDate));
    return {
      balance: await getVacationBalance(input.workspaceId, ctx.user.id, input.year, requests),
      requests: await decorate(requests),
      ...(await access(ctx.user, input.workspaceId)),
    };
  }),

  // Live working-day count + validation while the form is being filled in.
  preview: protectedProcedure.input(previewLeaveSchema).query(async ({ ctx, input }) => {
    const userId = input.userId ?? ctx.user.id;
    if (userId === ctx.user.id) await requireActiveMember(ctx.user, input.workspaceId);
    else await assertCanActOnLeaveOf(ctx.user, input.workspaceId, userId, "leave:recordForOthers");
    const { workingDays, balance, problem } = await checkLeave(input.workspaceId, userId, input);
    return { workingDays, available: balance.available, year: balance.year, problem };
  }),

  request: protectedProcedure.input(requestLeaveSchema).mutation(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const { workingDays, problem } = await checkLeave(input.workspaceId, ctx.user.id, input);
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
    await assertUsableDocument(input.workspaceId, ctx.user.id, input.documentAttachmentId);

    const [request] = await db
      .insert(schema.leaveRequests)
      .values({
        workspaceId: input.workspaceId,
        userId: ctx.user.id,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        workingDays,
        reason: input.reason || null,
        documentAttachmentId: input.documentAttachmentId ?? null,
      })
      .returning();
    if (!request) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const activity = await logActivity(
      input.workspaceId,
      ctx.user.id,
      "leave_request",
      request.id,
      "leave.requested",
      activityPayload(request),
    );
    await notifyUsers(activity.id, await leaveApproverIds(input.workspaceId, ctx.user.id));
    await publishLeave(input.workspaceId, request.id, "created");
    return request;
  }),

  decide: protectedProcedure.input(decideLeaveSchema).mutation(async ({ ctx, input }) => {
    const request = await requireLeaveRequest(input.leaveRequestId);
    await assertCanActOnLeaveOf(ctx.user, request.workspaceId, request.userId, "leave:approve");
    if (request.status !== "pending") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This request was already decided" });
    }
    if (input.decision === "approved") {
      const balance = await getVacationBalance(
        request.workspaceId,
        request.userId,
        yearOf(request.startDate),
      );
      const blocker = approvalBlocker(request, balance);
      if (blocker) throw new TRPCError({ code: "BAD_REQUEST", message: blocker });
    }

    const [updated] = await db
      .update(schema.leaveRequests)
      .set({
        status: input.decision,
        decidedBy: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: input.note || null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.leaveRequests.id, request.id), eq(schema.leaveRequests.status, "pending")),
      )
      .returning();
    if (!updated)
      throw new TRPCError({ code: "CONFLICT", message: "This request was already decided" });

    const activity = await logActivity(
      request.workspaceId,
      ctx.user.id,
      "leave_request",
      request.id,
      input.decision === "approved" ? "leave.approved" : "leave.rejected",
      { ...activityPayload(request), note: input.note ?? null },
    );
    await notifyUsers(activity.id, [request.userId]);
    await publishLeave(request.workspaceId, request.id, "updated");
    return updated;
  }),

  // The employee withdraws a pending request; HR can also cancel approved leave.
  cancel: protectedProcedure.input(leaveRequestIdSchema).mutation(async ({ ctx, input }) => {
    const request = await requireLeaveRequest(input.leaveRequestId);
    const own = request.userId === ctx.user.id;
    if (own && request.status === "pending") {
      await requireActiveMember(ctx.user, request.workspaceId);
    } else if (request.status === "pending" || request.status === "approved") {
      await assertCanActOnLeaveOf(
        ctx.user,
        request.workspaceId,
        request.userId,
        "leave:recordForOthers",
      );
    } else {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This request can't be cancelled" });
    }

    const [updated] = await db
      .update(schema.leaveRequests)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(schema.leaveRequests.id, request.id))
      .returning();
    const activity = await logActivity(
      request.workspaceId,
      ctx.user.id,
      "leave_request",
      request.id,
      "leave.cancelled",
      activityPayload(request),
    );
    if (!own) await notifyUsers(activity.id, [request.userId]);
    await publishLeave(request.workspaceId, request.id, "updated");
    return updated;
  }),

  // HR records leave for someone (e.g. a sick day phoned in) — approved at once.
  record: protectedProcedure.input(recordLeaveSchema).mutation(async ({ ctx, input }) => {
    await assertCanActOnLeaveOf(ctx.user, input.workspaceId, input.userId, "leave:recordForOthers");
    await assertActiveTarget(input.workspaceId, input.userId);
    const { workingDays, problem } = await checkLeave(input.workspaceId, input.userId, input);
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
    await assertUsableDocument(input.workspaceId, ctx.user.id, input.documentAttachmentId);

    const now = new Date();
    const [request] = await db
      .insert(schema.leaveRequests)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        workingDays,
        reason: input.reason || null,
        status: "approved",
        decidedBy: ctx.user.id,
        decidedAt: now,
        recordedBy: ctx.user.id,
        documentAttachmentId: input.documentAttachmentId ?? null,
      })
      .returning();
    if (!request) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const activity = await logActivity(
      input.workspaceId,
      ctx.user.id,
      "leave_request",
      request.id,
      "leave.recorded",
      activityPayload(request),
    );
    await notifyUsers(activity.id, [input.userId]);
    await publishLeave(input.workspaceId, request.id, "created");
    return request;
  }),

  // Approvals page: requests from the people the caller may approve for.
  team: protectedProcedure.input(leaveTeamSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "leave:approve");
    const scope = await leaveScopeFor(ctx.user, input.workspaceId);
    const rows = await db
      .select()
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.workspaceId, input.workspaceId),
          input.status === "pending" ? eq(schema.leaveRequests.status, "pending") : undefined,
          scope ? inArray(schema.leaveRequests.userId, scope) : undefined,
        ),
      )
      .orderBy(asc(schema.leaveRequests.startDate));
    const others = rows.filter((r) => r.userId !== ctx.user.id);
    const decorated = await decorate(others);
    // Vacation requests show what the person has left, so the approver sees the impact.
    return Promise.all(
      decorated.map(async (r) => ({
        ...r,
        balance:
          r.type === "vacation"
            ? await getVacationBalance(r.workspaceId, r.userId, yearOf(r.startDate))
            : null,
      })),
    );
  }),

  // Who's off: approved leave overlapping [from, to]. Everyone sees names and
  // dates; the leave type only for people whose leave they may see.
  calendar: protectedProcedure.input(leaveCalendarSchema).query(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const scope = await leaveScopeFor(ctx.user, input.workspaceId);
    const rows = await db
      .select({
        id: schema.leaveRequests.id,
        userId: schema.leaveRequests.userId,
        userName: schema.users.name,
        type: schema.leaveRequests.type,
        startDate: schema.leaveRequests.startDate,
        endDate: schema.leaveRequests.endDate,
      })
      .from(schema.leaveRequests)
      .innerJoin(schema.users, eq(schema.users.id, schema.leaveRequests.userId))
      .where(
        and(
          eq(schema.leaveRequests.workspaceId, input.workspaceId),
          eq(schema.leaveRequests.status, "approved"),
          lte(schema.leaveRequests.startDate, input.to),
          gte(schema.leaveRequests.endDate, input.from),
        ),
      )
      .orderBy(asc(schema.leaveRequests.startDate));
    return rows.map((r) => ({
      ...r,
      type: scope === null || scope.includes(r.userId) ? r.type : null,
    }));
  }),

  // HR: everyone's vacation balance for a year.
  balances: protectedProcedure.input(leaveBalanceSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "leave:recordForOthers");
    const members = await db
      .select({ userId: schema.users.id, name: schema.users.name })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .leftJoin(
        schema.employeeProfiles,
        eq(schema.employeeProfiles.membershipId, schema.memberships.id),
      )
      .where(and(eq(schema.memberships.workspaceId, input.workspaceId), activeMembershipCondition))
      .orderBy(asc(schema.users.name));
    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, input.workspaceId),
    });
    const rows = await Promise.all(
      members.map(async (m) => {
        const row = await findBalanceRow(input.workspaceId, m.userId, input.year);
        return {
          ...m,
          entitlementOverride: row?.entitlementDays ?? null,
          carriedOverStored: row?.carriedOverDays ?? null,
          balance: await getVacationBalance(input.workspaceId, m.userId, input.year),
        };
      }),
    );
    return { defaultVacationDays: workspace?.defaultVacationDays ?? 20, rows };
  }),

  setBalance: protectedProcedure.input(setLeaveBalanceSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "leave:recordForOthers", {
      targetUserId: input.userId,
    });
    const set = {
      ...(input.entitlementDays !== undefined ? { entitlementDays: input.entitlementDays } : {}),
      ...(input.carriedOverDays !== undefined ? { carriedOverDays: input.carriedOverDays } : {}),
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(schema.leaveBalances)
      .values({ workspaceId: input.workspaceId, userId: input.userId, year: input.year, ...set })
      .onConflictDoUpdate({
        target: [
          schema.leaveBalances.userId,
          schema.leaveBalances.workspaceId,
          schema.leaveBalances.year,
        ],
        set,
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(
      input.workspaceId,
      ctx.user.id,
      "leave_balance",
      row.id,
      "leave.balance_updated",
      {
        userId: input.userId,
        year: input.year,
        entitlementDays: row.entitlementDays,
        carriedOverDays: row.carriedOverDays,
      },
    );
    await publishLeave(input.workspaceId, row.id, "updated");
    return row;
  }),

  setDefaultVacationDays: protectedProcedure
    .input(setDefaultVacationDaysSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "leave:recordForOthers");
      await db
        .update(schema.workspaces)
        .set({ defaultVacationDays: input.days })
        .where(eq(schema.workspaces.id, input.workspaceId));
      await logActivity(
        input.workspaceId,
        ctx.user.id,
        "workspace",
        input.workspaceId,
        "workspace.default_vacation_days_changed",
        { days: input.days },
      );
      await publishLeave(input.workspaceId, input.workspaceId, "updated");
      return { days: input.days };
    }),

  // Supporting document (doctor's note), uploaded straight to storage like
  // task attachments, then confirmed before the request references it.
  presignDocument: protectedProcedure
    .input(presignLeaveDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await requireActiveMember(ctx.user, input.workspaceId);
      const attachmentId = uuidv7();
      const key = `${LEAVE_DOCUMENT_KEY_PREFIX}${input.workspaceId}/${attachmentId}/${sanitizeFilenameForKey(input.fileName)}`;
      return { attachmentId, key, uploadUrl: await getPresignedUploadUrl(key, input.mime) };
    }),

  confirmDocument: protectedProcedure
    .input(confirmLeaveDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await requireActiveMember(ctx.user, input.workspaceId);
      if (
        !input.key.startsWith(
          `${LEAVE_DOCUMENT_KEY_PREFIX}${input.workspaceId}/${input.attachmentId}/`,
        )
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unexpected upload key" });
      }
      const head = await headObject(input.key);
      if (!head) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload did not complete" });
      const [attachment] = await db
        .insert(schema.attachments)
        .values({
          id: input.attachmentId,
          workspaceId: input.workspaceId,
          uploaderId: ctx.user.id,
          fileKey: input.key,
          fileName: input.fileName,
          mime: input.mime,
          sizeBytes: head.ContentLength ?? 0,
        })
        .returning();
      if (!attachment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await logActivity(
        input.workspaceId,
        ctx.user.id,
        "attachment",
        attachment.id,
        "attachment.created",
        {
          leaveDocument: true,
        },
      );
      return { id: attachment.id, fileName: attachment.fileName };
    }),
});
