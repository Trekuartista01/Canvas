import { db, schema } from "@canvas/db";
import {
  confirmLeaveDocumentSchema,
  countWorkingDays,
  decideLeaveSchema,
  leaveBalanceSchema,
  leaveCalendarSchema,
  leaveRequestIdSchema,
  leaveTeamSchema,
  nextWorkingDay,
  presignLeaveDocumentSchema,
  previewLeaveSchema,
  recordLeaveSchema,
  requestLeaveSchema,
  setDefaultVacationDaysSchema,
  setLeaveBalanceSchema,
  leaveMessages,
  vendimDownloadSchema,
  type LeaveType,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { SessionUser } from "../../auth/session";
import { emailUsers } from "../../email/send-email";
import { env } from "../../env";
import { logActivity } from "../../lib/activity";
import {
  assertCanActOnLeaveOf,
  findBalanceRow,
  getVacationBalance,
  leaveApproverIds,
  leaveScopeFor,
  loadLeaveRequests,
} from "../../lib/leave";
import {
  balanceAfter,
  validateLeaveRequest,
  yearOf,
  yearsOf,
  type LeaveLike,
} from "../../lib/leave-balance";
import { writeAudit } from "../../lib/audit";
import { activeMembershipCondition, getMembershipRole } from "../../lib/membership";
import { notifyUsers } from "../../lib/notify";
import { getPresignedUrl } from "../../lib/storage";
import { needsVendim } from "../../lib/vendim-job";
import { enqueueVendim } from "../../queues/vendim-queue";
import { assertCanPeople, canPeopleAction, requireActiveMember } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import {
  PRIVATE_PREFIXES,
  confirmPrivateUpload,
  presignPrivateUpload,
  requirePrivateAttachment,
} from "../../lib/private-upload";
import { loadHolidayCalendar, nextWorkingDay as nextWorkingDayIn } from "../../lib/working-days";
import { protectedProcedure, router } from "../trpc";

type LeaveInput = { type: LeaveType; startDate: string; endDate: string };

/**
 * Everything about a request for `userId` before it exists: working days
 * (P8.2 calculator), the per-year split, the return date, each touched
 * year's balance, what's left after it, a balance warning (P8.4: never a
 * block) and the hard problem that refuses it (null = fine).
 */
async function checkLeave(workspaceId: string, userId: string, input: LeaveInput) {
  const calendar = await loadHolidayCalendar(workspaceId);
  const count = countWorkingDays(input.startDate, input.endDate, calendar);
  const workingDays = count.total;
  const byYear = Object.fromEntries(
    Object.entries(count.byYear).map(([year, days]) => [String(year), days]),
  );
  const returnDate =
    input.endDate < input.startDate ? null : nextWorkingDay(input.endDate, calendar);
  const existing = await loadLeaveRequests(workspaceId, userId);
  const years = workingDays > 0 ? Object.keys(byYear).map(Number) : [yearOf(input.startDate)];
  const balances = await Promise.all(
    years.map((y) => getVacationBalance(workspaceId, userId, y, existing)),
  );
  const { remainingAfter, warning } = balanceAfter(input.type, byYear, balances);
  const problem = validateLeaveRequest({ ...input, workingDays, existing });
  return { workingDays, count, byYear, returnDate, balances, remainingAfter, warning, problem };
}

function approvalsLink(workspaceId: string, requestId: string) {
  return `${env.WEB_URL}/w/${workspaceId}/leave-approvals?request=${requestId}`;
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
  await requirePrivateAttachment(PRIVATE_PREFIXES.leave, workspaceId, attachmentId, uploaderId);
  const linked = await db.query.leaveRequests.findFirst({
    where: eq(schema.leaveRequests.documentAttachmentId, attachmentId),
  });
  if (linked) {
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

// Storage keys never leave the server (P8.5): the browser only learns
// whether a Vendim file exists and asks vendimDownload for a signed link.
async function decorate<
  T extends {
    userId: string;
    decidedBy: string | null;
    recordedBy: string | null;
    vendimPdfKey: string | null;
    vendimDocxKey: string | null;
  },
>(rows: T[]) {
  const names = await namesById(
    rows.flatMap((r) => [r.userId, r.decidedBy, r.recordedBy]).filter((id): id is string => !!id),
  );
  return rows.map(({ vendimPdfKey, vendimDocxKey, ...r }) => ({
    ...r,
    hasVendimPdf: vendimPdfKey !== null,
    hasVendimDocx: vendimDocxKey !== null,
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
    const c = await checkLeave(input.workspaceId, userId, input);
    return {
      workingDays: c.workingDays,
      byYear: c.byYear,
      excludedHolidays: c.count.excludedHolidays,
      excludedWeekendDays: c.count.excludedWeekendDays,
      returnDate: c.returnDate,
      remainingAfter: c.remainingAfter,
      warning: c.warning,
      problem: c.problem,
    };
  }),

  request: protectedProcedure.input(requestLeaveSchema).mutation(async ({ ctx, input }) => {
    await requireActiveMember(ctx.user, input.workspaceId);
    const { workingDays, byYear, count, problem } = await checkLeave(
      input.workspaceId,
      ctx.user.id,
      input,
    );
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
        byYear,
        excludedHolidays: count.excludedHolidays,
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
    // Every HR user (another HR user when the requester is HR), in-app and by email.
    const hrIds = await leaveApproverIds(input.workspaceId, ctx.user.id);
    await notifyUsers(activity.id, hrIds);
    const text = leaveMessages.requested({ name: ctx.user.name, ...request });
    void emailUsers(
      hrIds,
      `Leave request: ${ctx.user.name}`,
      `${text}

Open the request: ${approvalsLink(input.workspaceId, request.id)}`,
    );
    await publishLeave(input.workspaceId, request.id, "created");
    return request;
  }),

  // P8.4 (spec §3): HR only. HR's own request needs another HR user; a lone
  // HR user may decide it, flagged self-approved in the audit log. The
  // balance never blocks — HR sees it and decides.
  decide: protectedProcedure.input(decideLeaveSchema).mutation(async ({ ctx, input }) => {
    const request = await requireLeaveRequest(input.leaveRequestId);
    const own = request.userId === ctx.user.id;
    await assertCanPeople(ctx.user, request.workspaceId, "leave:approve", {
      targetUserId: request.userId,
    });
    if (own && (await leaveApproverIds(request.workspaceId, ctx.user.id)).length > 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Another HR user has to decide on your own leave",
      });
    }
    if (request.status !== "pending") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This request was already decided" });
    }
    const approved = input.decision === "approved";

    const [updated] = await db
      .update(schema.leaveRequests)
      .set({
        status: input.decision,
        decidedBy: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: input.note || null,
        rejectionReason: approved ? null : (input.note ?? null),
        selfApproved: own,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.leaveRequests.id, request.id), eq(schema.leaveRequests.status, "pending")),
      )
      .returning();
    if (!updated) {
      throw new TRPCError({ code: "CONFLICT", message: "This request was already decided" });
    }

    const returnDate = approved
      ? await nextWorkingDayIn(request.workspaceId, request.endDate)
      : null;
    const activity = await logActivity(
      request.workspaceId,
      ctx.user.id,
      "leave_request",
      request.id,
      approved ? "leave.approved" : "leave.rejected",
      { ...activityPayload(request), note: input.note ?? null, returnDate },
    );
    await writeAudit({
      workspaceId: request.workspaceId,
      actorId: ctx.user.id,
      action: own ? `leave.self_${input.decision}` : `leave.${input.decision}`,
      entity: "leave_request",
      entityId: request.id,
      ip: ctx.ip,
      payload: { userId: request.userId, selfApproved: own },
    });

    if (!own) {
      await notifyUsers(activity.id, [request.userId]);
      const text = approved
        ? leaveMessages.approved({ ...request, returnDate: returnDate! })
        : leaveMessages.rejected({ ...request, reason: input.note ?? "" });
      void emailUsers(
        [request.userId],
        approved ? "Your leave was approved" : "Your leave request was not approved",
        `${text}\n\n${env.WEB_URL}/w/${request.workspaceId}/leave`,
      );
    }
    if (needsVendim(updated)) await enqueueVendim(updated.id);
    await publishLeave(request.workspaceId, request.id, "updated");
    return updated;
  }),

  // P8.5 Vendim: HR only (spec §3 — the employee doesn't get the file).
  // A 5-minute signed link, downloaded under a readable name; audited.
  vendimDownload: protectedProcedure
    .input(vendimDownloadSchema)
    .mutation(async ({ ctx, input }) => {
      const request = await requireLeaveRequest(input.leaveRequestId);
      await assertCanPeople(ctx.user, request.workspaceId, "leave:approve", {
        targetUserId: request.userId,
      });
      const key = input.format === "pdf" ? request.vendimPdfKey : request.vendimDocxKey;
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "No Vendim file yet" });
      const person = await db.query.users.findFirst({ where: eq(schema.users.id, request.userId) });
      const fileName = `Vendim pushim vjetor - ${person?.name ?? "punonjes"} - ${request.startDate}.${input.format}`;
      await writeAudit({
        workspaceId: request.workspaceId,
        actorId: ctx.user.id,
        action: "leave.vendim_downloaded",
        entity: "leave_request",
        entityId: request.id,
        ip: ctx.ip,
        payload: { userId: request.userId, format: input.format },
      });
      return { url: await getPresignedUrl(key, 300, fileName) };
    }),

  vendimRegenerate: protectedProcedure
    .input(leaveRequestIdSchema)
    .mutation(async ({ ctx, input }) => {
      const request = await requireLeaveRequest(input.leaveRequestId);
      await assertCanPeople(ctx.user, request.workspaceId, "leave:approve", {
        targetUserId: request.userId,
      });
      if (!needsVendim(request)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only approved annual leave has a Vendim",
        });
      }
      await db
        .update(schema.leaveRequests)
        .set({ vendimError: null, updatedAt: new Date() })
        .where(eq(schema.leaveRequests.id, request.id));
      await enqueueVendim(request.id);
      await logActivity(
        request.workspaceId,
        ctx.user.id,
        "leave_request",
        request.id,
        "leave.vendim_regenerated",
        { userId: request.userId },
      );
      await publishLeave(request.workspaceId, request.id, "updated");
      return { queued: true };
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
    const { workingDays, byYear, count, problem } = await checkLeave(
      input.workspaceId,
      input.userId,
      input,
    );
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
        byYear,
        excludedHolidays: count.excludedHolidays,
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
    if (needsVendim(request)) await enqueueVendim(request.id);
    await publishLeave(input.workspaceId, request.id, "created");
    return request;
  }),

  // P8.4 Leave approvals (HR): Pending / Approved / Rejected, HR's own
  // requests included. Each request carries what HR needs to decide:
  // excluded holidays (stored on it), each touched year's balance before
  // and after, other people's approved leave on the same dates, and
  // whether this caller may decide it.
  team: protectedProcedure.input(leaveTeamSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "leave:approve");
    const scope = await leaveScopeFor(ctx.user, input.workspaceId);
    const rows = await db
      .select()
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.workspaceId, input.workspaceId),
          input.status === "all" ? undefined : eq(schema.leaveRequests.status, input.status),
          scope ? inArray(schema.leaveRequests.userId, scope) : undefined,
        ),
      )
      .orderBy(
        input.status === "pending"
          ? asc(schema.leaveRequests.startDate)
          : desc(schema.leaveRequests.startDate),
      );
    const decorated = await decorate(rows);
    const otherHr = (await leaveApproverIds(input.workspaceId, ctx.user.id)).length > 0;

    // Other people's approved leave in the span of these requests, for overlaps.
    const span = rows.reduce<{ from: string; to: string } | null>(
      (acc, r) => ({
        from: !acc || r.startDate < acc.from ? r.startDate : acc.from,
        to: !acc || r.endDate > acc.to ? r.endDate : acc.to,
      }),
      null,
    );
    const approvedInSpan = span
      ? await db
          .select({
            id: schema.leaveRequests.id,
            userId: schema.leaveRequests.userId,
            userName: schema.users.name,
            startDate: schema.leaveRequests.startDate,
            endDate: schema.leaveRequests.endDate,
          })
          .from(schema.leaveRequests)
          .innerJoin(schema.users, eq(schema.users.id, schema.leaveRequests.userId))
          .where(
            and(
              eq(schema.leaveRequests.workspaceId, input.workspaceId),
              eq(schema.leaveRequests.status, "approved"),
              lte(schema.leaveRequests.startDate, span.to),
              gte(schema.leaveRequests.endDate, span.from),
            ),
          )
      : [];

    const requestsByUser = new Map<string, Promise<LeaveLike[]>>();
    const requestsOf = (userId: string) => {
      let p = requestsByUser.get(userId);
      if (!p) requestsByUser.set(userId, (p = loadLeaveRequests(input.workspaceId, userId)));
      return p;
    };

    return Promise.all(
      decorated.map(async (r) => {
        const balances =
          r.type === "vacation"
            ? await Promise.all(
                yearsOf(r).map(async (year) => {
                  const b = await getVacationBalance(
                    r.workspaceId,
                    r.userId,
                    year,
                    await requestsOf(r.userId),
                  );
                  const days = r.byYear[String(year)] ?? r.workingDays;
                  // Approved leave is already in remaining; pending isn't.
                  const before = r.status === "approved" ? b.remaining + days : b.remaining;
                  const after =
                    r.status === "rejected" || r.status === "cancelled" ? before : before - days;
                  return { year, total: b.total, before, after: Math.round(after * 10) / 10 };
                }),
              )
            : [];
        const overlaps = approvedInSpan
          .filter(
            (o) => o.userId !== r.userId && o.startDate <= r.endDate && o.endDate >= r.startDate,
          )
          .map((o) => ({ userName: o.userName, startDate: o.startDate, endDate: o.endDate }));
        const own = r.userId === ctx.user.id;
        return {
          ...r,
          own,
          canDecide: r.status === "pending" && (!own || !otherHr),
          balances,
          overlaps,
        };
      }),
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
      return presignPrivateUpload(PRIVATE_PREFIXES.leave, input);
    }),

  confirmDocument: protectedProcedure
    .input(confirmLeaveDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      await requireActiveMember(ctx.user, input.workspaceId);
      return confirmPrivateUpload(PRIVATE_PREFIXES.leave, ctx.user.id, input);
    }),
});
