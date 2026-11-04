import { db, schema } from "@canvas/db";
import {
  archivePersonSchema,
  createStaffSchema,
  effectivePeopleRole,
  PEOPLE_ACTIONS,
  PEOPLE_ROLE_LABELS,
  PRIVILEGED_PEOPLE_ROLES,
  peopleDirectorySchema,
  peopleMemberSchema,
  setManagerSchema,
  decideRoleRequestSchema,
  type PeopleRole,
  listRoleRequestsSchema,
  setPeopleRoleSchema,
  updateConfidentialSchema,
  updateEmployeeProfileSchema,
  WORKSPACE_ACTIONS,
  workspaceScopedSchema,
  wouldCreateReportingCycle,
  type EmployeeProfileFields,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { can } from "../../auth/can";
import type { SessionUser } from "../../auth/session";
import { hashPassword } from "../../auth/password";
import { emailUsers } from "../../email/send-email";
import { logActivity } from "../../lib/activity";
import { writeAudit } from "../../lib/audit";
import {
  activeMembershipCondition,
  findMembership,
  getMembershipContext,
  getMembershipRole,
  getPeopleContext,
  listHrUserIds,
} from "../../lib/membership";
import { notifyUsers } from "../../lib/notify";
import {
  deletePersonRecords,
  encryptPersonalNumber,
  loadConfidential,
} from "../../lib/people-records";
import { assertCanPeople, requireActiveMember } from "../../lib/permissions";
import { getCustomRoleDeltas } from "../../lib/space-overrides";
import { protectedProcedure, router } from "../trpc";

const PROFILE_FIELDS = [
  "phone",
  "address",
  "dateOfBirth",
  "jobTitle",
  "department",
  "employmentStartDate",
  "emergencyContactName",
  "emergencyContactPhone",
] as const satisfies readonly (keyof EmployeeProfileFields)[];

// Only the fields the caller actually sent — undefined means "leave as is".
function pickProfileFields(input: EmployeeProfileFields) {
  const values: Partial<Record<(typeof PROFILE_FIELDS)[number], string | null>> = {};
  for (const field of PROFILE_FIELDS) {
    if (input[field] !== undefined) values[field] = input[field];
  }
  return values;
}

async function requireTargetMembership(workspaceId: string, userId: string) {
  const membership = await findMembership(workspaceId, userId);
  if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
  return membership;
}

async function upsertProfile(membershipId: string, values: Record<string, unknown>) {
  await db
    .insert(schema.employeeProfiles)
    .values({ membershipId, ...values })
    .onConflictDoUpdate({
      target: schema.employeeProfiles.membershipId,
      set: { ...values, updatedAt: new Date() },
    });
}

// A reports-to target must be an active member of the same workspace, not
// the member themselves, and not someone who (transitively) reports to them.
async function assertValidManager(workspaceId: string, userId: string, managerUserId: string) {
  if (!(await getMembershipRole(workspaceId, managerUserId))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Manager must be an active member" });
  }
  const rows = await db
    .select({ userId: schema.memberships.userId, managerUserId: schema.memberships.managerUserId })
    .from(schema.memberships)
    .where(eq(schema.memberships.workspaceId, workspaceId));
  const managerOf = new Map(rows.map((r) => [r.userId, r.managerUserId]));
  if (wouldCreateReportingCycle(userId, managerUserId, managerOf)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That would make someone their own manager",
    });
  }
}

async function canPeople(
  user: SessionUser,
  workspaceId: string,
  action: (typeof PEOPLE_ACTIONS)[number],
  targetUserId?: string,
) {
  try {
    await assertCanPeople(user, workspaceId, action, targetUserId ? { targetUserId } : undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every change of someone's role goes through here, whether set by hand or by
 * approving a request: the same refusals, audit row and HR notice. The caller
 * has checked roles:assign.
 */
async function applyRoleChange(
  ctx: { user: SessionUser; ip: string | null },
  input: { workspaceId: string; userId: string; peopleRole: PeopleRole },
) {
  const membership = await requireTargetMembership(input.workspaceId, input.userId);
  if (membership.role === "owner") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The workspace owner is always an admin",
    });
  }
  if (input.peopleRole === "hr_finance" && input.userId === ctx.user.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can't give yourself the HR/Finance Manager role",
    });
  }
  const from = membership.peopleRole;
  if (from === input.peopleRole) {
    await db
      .update(schema.memberships)
      .set({ requestedPeopleRole: null, roleRequestedAt: null })
      .where(eq(schema.memberships.id, membership.id));
    return { userId: input.userId, peopleRole: input.peopleRole };
  }

  // Told before and after the change, so an HR user who loses the role hears too.
  const hrBefore = await listHrUserIds(input.workspaceId);
  await db
    .update(schema.memberships)
    // Settles any waiting request: the Admin has decided.
    .set({ peopleRole: input.peopleRole, requestedPeopleRole: null, roleRequestedAt: null })
    .where(eq(schema.memberships.id, membership.id));
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, input.userId) });
  const activity = await logActivity(
    input.workspaceId,
    ctx.user.id,
    "person",
    input.userId,
    "person.role_changed",
    { from, to: input.peopleRole, name: target?.name ?? "" },
  );

  if (
    PRIVILEGED_PEOPLE_ROLES.includes(from) ||
    PRIVILEGED_PEOPLE_ROLES.includes(input.peopleRole)
  ) {
    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      action: "person.role_changed",
      entity: "person",
      entityId: input.userId,
      ip: ctx.ip,
      payload: { from, to: input.peopleRole },
    });
    const hrIds = [...new Set([...hrBefore, ...(await listHrUserIds(input.workspaceId))])];
    await notifyUsers(activity.id, hrIds);
    const line = `${ctx.user.name} changed roles: ${target?.name ?? "someone"} is now ${PEOPLE_ROLE_LABELS[input.peopleRole]}.`;
    void emailUsers(hrIds, "Canvas: a role was changed", line);
  }
  return { userId: input.userId, peopleRole: input.peopleRole };
}

export const peopleRouter = router({
  // Everything the caller may do in this workspace, so the UI can show only
  // the nav sections and controls they can use. Space overrides aren't
  // applied (they're per-space, and the nav isn't); every procedure still
  // runs its own real check.
  myAccess: protectedProcedure.input(workspaceScopedSchema).query(async ({ ctx, input }) => {
    const { role, customRoleId } = await getMembershipContext(input.workspaceId, ctx.user.id);
    const people = await getPeopleContext(input.workspaceId, ctx.user.id);
    if (!role || !people) throw new TRPCError({ code: "FORBIDDEN" });
    const customRole = customRoleId ? await getCustomRoleDeltas(customRoleId) : null;

    const actions: string[] = [
      ...WORKSPACE_ACTIONS.filter((action) =>
        can(ctx.user, action, { type: "workspace", role, customRole }),
      ),
      ...PEOPLE_ACTIONS.filter((action) =>
        can(ctx.user, action, { type: "people", peopleRole: people.peopleRole }),
      ),
    ];
    return { role, peopleRole: people.peopleRole, actions };
  }),

  // Name, photo, position, department, email — nothing confidential.
  // Deactivated people only for HR.
  directory: protectedProcedure.input(peopleDirectorySchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:viewDirectory");
    if (input.includeInactive) {
      await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff");
    }
    const manager = alias(schema.users, "manager");

    const rows = await db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        avatarUrl: schema.users.avatarUrl,
        role: schema.memberships.role,
        storedPeopleRole: schema.memberships.peopleRole,
        managerUserId: schema.memberships.managerUserId,
        managerName: manager.name,
        jobTitle: schema.employeeProfiles.jobTitle,
        department: schema.employeeProfiles.department,
        status: schema.employeeProfiles.status,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .leftJoin(manager, eq(manager.id, schema.memberships.managerUserId))
      .leftJoin(
        schema.employeeProfiles,
        eq(schema.employeeProfiles.membershipId, schema.memberships.id),
      )
      .where(
        and(
          eq(schema.memberships.workspaceId, input.workspaceId),
          input.includeInactive ? undefined : activeMembershipCondition,
        ),
      )
      .orderBy(asc(schema.users.name));

    return rows.map(({ storedPeopleRole, status, ...row }) => ({
      ...row,
      peopleRole: effectivePeopleRole(row.role, storedPeopleRole),
      status: status ?? ("active" as const),
    }));
  }),

  // Directory roles see the public part of anyone's profile; the
  // confidential part (personal details, employment start) only HR and the
  // person themselves — stripped here, never just hidden in the UI.
  profile: protectedProcedure.input(peopleMemberSchema).query(async ({ ctx, input }) => {
    const isSelf = input.userId === ctx.user.id;
    if (isSelf) await requireActiveMember(ctx.user, input.workspaceId);
    else await assertCanPeople(ctx.user, input.workspaceId, "people:viewDirectory");
    const membership = await requireTargetMembership(input.workspaceId, input.userId);
    const canManage = await canPeople(ctx.user, input.workspaceId, "people:manageStaff");
    // P8.3: archived people exist only for HR.
    if (!membership.active && !canManage) throw new TRPCError({ code: "NOT_FOUND" });
    const confidential = await canPeople(
      ctx.user,
      input.workspaceId,
      "people:viewProfile",
      input.userId,
    );
    const [user, profile, manager] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, input.userId) }),
      db.query.employeeProfiles.findFirst({
        where: eq(schema.employeeProfiles.membershipId, membership.id),
      }),
      membership.managerUserId
        ? db.query.users.findFirst({ where: eq(schema.users.id, membership.managerUserId) })
        : null,
    ]);
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });

    if (confidential && !isSelf) {
      await writeAudit({
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        action: "person.profile_viewed",
        entity: "person",
        entityId: input.userId,
        ip: ctx.ip,
      });
    }

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: membership.role,
      isOwner: membership.role === "owner",
      peopleRole: effectivePeopleRole(membership.role, membership.peopleRole),
      managerUserId: membership.managerUserId,
      managerName: manager?.name ?? null,
      status: membership.active ? ("active" as const) : ("inactive" as const),
      deactivatedAt: profile?.deactivatedAt ?? null,
      archivedAt: canManage ? (profile?.archivedAt ?? null) : null,
      jobTitle: profile?.jobTitle ?? null,
      department: profile?.department ?? null,
      employmentStartDate: confidential ? (profile?.employmentStartDate ?? null) : null,
      personal: confidential
        ? {
            phone: profile?.phone ?? null,
            address: profile?.address ?? null,
            dateOfBirth: profile?.dateOfBirth ?? null,
            emergencyContactName: profile?.emergencyContactName ?? null,
            emergencyContactPhone: profile?.emergencyContactPhone ?? null,
          }
        : null,
      canManage,
      canAssignRoles: await canPeople(ctx.user, input.workspaceId, "roles:assign"),
    };
  }),

  // HR creates the account directly; the new member signs in with the
  // initial password. An email that already has an account is refused —
  // attaching someone's existing account without their consent is exactly
  // what the invite flow (accepted by the account holder) is for. Anything
  // but "employee" is a role assignment, which is admin's alone.
  createStaff: protectedProcedure.input(createStaffSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff");
    if (input.peopleRole !== "employee") {
      await assertCanPeople(ctx.user, input.workspaceId, "roles:assign");
    }
    const existing = await db.query.users.findFirst({ where: eq(schema.users.email, input.email) });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Someone already has an account with this email — invite them instead.",
      });
    }
    if (input.managerUserId && !(await getMembershipRole(input.workspaceId, input.managerUserId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Manager must be an active member" });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.users)
        .values({ email: input.email, name: input.name, passwordHash })
        .returning();
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [membership] = await tx
        .insert(schema.memberships)
        .values({
          workspaceId: input.workspaceId,
          userId: created.id,
          role: "member",
          peopleRole: input.peopleRole,
          managerUserId: input.managerUserId ?? null,
        })
        .returning();
      if (!membership) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await tx
        .insert(schema.employeeProfiles)
        .values({ membershipId: membership.id, ...pickProfileFields(input) });
      return created;
    });

    await logActivity(input.workspaceId, ctx.user.id, "person", user.id, "person.created", {
      name: user.name,
      peopleRole: input.peopleRole,
    });
    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      action: "person.created",
      entity: "person",
      entityId: user.id,
      ip: ctx.ip,
    });
    return { userId: user.id };
  }),

  updateProfile: protectedProcedure
    .input(updateEmployeeProfileSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff", {
        targetUserId: input.userId,
      });
      const membership = await requireTargetMembership(input.workspaceId, input.userId);
      const values = pickProfileFields(input);
      await upsertProfile(membership.id, values);
      await logActivity(
        input.workspaceId,
        ctx.user.id,
        "person",
        input.userId,
        "person.profile_updated",
        { fields: Object.keys(values) },
      );
      await writeAudit({
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        action: "person.profile_updated",
        entity: "person",
        entityId: input.userId,
        ip: ctx.ip,
        payload: { fields: Object.keys(values) },
      });
      return { userId: input.userId };
    }),

  // Admin only (roles:assign). Admin can never make themselves HR, and every
  // change to who holds hr_finance, ceo or operations_manager is audited and
  // announced to every HR user, in-app and by email (spec §1).
  setRole: protectedProcedure.input(setPeopleRoleSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "roles:assign", {
      targetUserId: input.userId,
    });
    return applyRoleChange(ctx, input);
  }),

  // Who asked for a role when joining and is still waiting. Admin only.
  roleRequests: protectedProcedure.input(listRoleRequestsSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "roles:assign");
    const rows = await db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        requestedRole: schema.memberships.requestedPeopleRole,
        requestedAt: schema.memberships.roleRequestedAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .leftJoin(
        schema.employeeProfiles,
        eq(schema.employeeProfiles.membershipId, schema.memberships.id),
      )
      .where(
        and(
          eq(schema.memberships.workspaceId, input.workspaceId),
          isNotNull(schema.memberships.requestedPeopleRole),
          activeMembershipCondition,
        ),
      )
      .orderBy(asc(schema.memberships.roleRequestedAt));
    return rows.map((r) => ({ ...r, requestedRole: r.requestedRole as PeopleRole }));
  }),

  // Approving applies the role that's stored, not anything in this request.
  decideRoleRequest: protectedProcedure
    .input(decideRoleRequestSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "roles:assign", {
        targetUserId: input.userId,
      });
      const membership = await requireTargetMembership(input.workspaceId, input.userId);
      const requested = membership.requestedPeopleRole;
      if (!requested) {
        throw new TRPCError({ code: "CONFLICT", message: "That request has already been decided" });
      }
      if (input.approve) {
        await applyRoleChange(ctx, { ...input, peopleRole: requested });
      } else {
        await db
          .update(schema.memberships)
          .set({ requestedPeopleRole: null, roleRequestedAt: null })
          .where(eq(schema.memberships.id, membership.id));
      }
      const activity = await logActivity(
        input.workspaceId,
        ctx.user.id,
        "person",
        input.userId,
        input.approve ? "person.role_request_approved" : "person.role_request_declined",
        { requested },
      );
      await notifyUsers(activity.id, [input.userId]);
      return { userId: input.userId, approved: input.approve };
    }),

  setManager: protectedProcedure.input(setManagerSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff", {
      targetUserId: input.userId,
    });
    const membership = await requireTargetMembership(input.workspaceId, input.userId);
    if (input.managerUserId) {
      await assertValidManager(input.workspaceId, input.userId, input.managerUserId);
    }

    await db
      .update(schema.memberships)
      .set({ managerUserId: input.managerUserId })
      .where(eq(schema.memberships.id, membership.id));
    await logActivity(
      input.workspaceId,
      ctx.user.id,
      "person",
      input.userId,
      "person.manager_changed",
      { from: membership.managerUserId, to: input.managerUserId },
    );
    return { userId: input.userId, managerUserId: input.managerUserId };
  }),

  // P8.3 Confidential tab (spec §5): HR only — not even the person
  // themselves (they get My Pay Details). Every look is audited.
  confidential: protectedProcedure.input(peopleMemberSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff");
    await assertCanPeople(ctx.user, input.workspaceId, "payroll:view");
    const membership = await requireTargetMembership(input.workspaceId, input.userId);
    const data = await loadConfidential(input.workspaceId, input.userId, membership.id);
    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      action: "person.confidential_viewed",
      entity: "person",
      entityId: input.userId,
      ip: ctx.ip,
    });
    return data;
  }),

  updateConfidential: protectedProcedure
    .input(updateConfidentialSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff");
      await assertCanPeople(ctx.user, input.workspaceId, "payroll:manage");
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Someone else has to change your own confidential details",
        });
      }
      const membership = await requireTargetMembership(input.workspaceId, input.userId);
      const { workspaceId, userId } = input;

      const profile = {
        ...(input.personalNumber !== undefined
          ? { personalNumberEnc: encryptPersonalNumber(workspaceId, userId, input.personalNumber) }
          : {}),
        ...(input.payCurrency !== undefined ? { payCurrency: input.payCurrency } : {}),
        ...(input.contractType !== undefined ? { contractType: input.contractType } : {}),
        ...(input.contractStart !== undefined ? { contractStart: input.contractStart } : {}),
        ...(input.contractEnd !== undefined ? { contractEnd: input.contractEnd } : {}),
      };
      const pay = {
        ...(input.grossSalary !== undefined ? { grossSalary: input.grossSalary } : {}),
        ...(input.netSalary !== undefined ? { netSalaryEur: input.netSalary } : {}),
      };
      if (Object.keys(profile).length > 0) await upsertProfile(membership.id, profile);
      if (Object.keys(pay).length > 0) {
        const values = { ...pay, updatedBy: ctx.user.id, updatedAt: new Date() };
        await db
          .insert(schema.payrollRecords)
          .values({ workspaceId, userId, ...values })
          .onConflictDoUpdate({
            target: [schema.payrollRecords.workspaceId, schema.payrollRecords.userId],
            set: values,
          });
      }

      // Which fields changed — never what they changed to.
      const fields = (
        [
          "personalNumber",
          "payCurrency",
          "contractType",
          "contractStart",
          "contractEnd",
          "grossSalary",
          "netSalary",
        ] as const
      ).filter((f) => input[f] !== undefined);
      await logActivity(workspaceId, ctx.user.id, "person", userId, "person.confidential_updated", {
        fields,
      });
      await writeAudit({
        workspaceId,
        actorId: ctx.user.id,
        action: "person.confidential_updated",
        entity: "person",
        entityId: userId,
        ip: ctx.ip,
        payload: { fields },
      });
      return { userId };
    }),

  // P8.3 "Remove" = archive (spec §5): the person drops out of every list
  // and can't open the workspace (lib/membership.ts treats status
  // 'inactive' as a non-member); contracts, payroll and leave stay.
  archive: protectedProcedure.input(archivePersonSchema).mutation(async ({ ctx, input }) => {
    const membership = await requireArchivable(ctx.user, input.workspaceId, input.userId);
    const now = new Date();
    await upsertProfile(membership.id, { status: "inactive", deactivatedAt: now, archivedAt: now });
    await recordPersonChange(ctx, input.workspaceId, input.userId, "person.archived");
    return { userId: input.userId };
  }),

  unarchive: protectedProcedure.input(archivePersonSchema).mutation(async ({ ctx, input }) => {
    const membership = await requireArchivable(ctx.user, input.workspaceId, input.userId);
    await upsertProfile(membership.id, { status: "active", deactivatedAt: null, archivedAt: null });
    await recordPersonChange(ctx, input.workspaceId, input.userId, "person.unarchived");
    return { userId: input.userId };
  }),

  // Only for someone already archived, and only HR (spec §5). Irreversible.
  deletePermanently: protectedProcedure
    .input(archivePersonSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireArchivable(ctx.user, input.workspaceId, input.userId);
      if (membership.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Archive this person before deleting them permanently",
        });
      }
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, input.userId) });
      const deleted = await deletePersonRecords(input.workspaceId, input.userId, membership.id);
      await recordPersonChange(ctx, input.workspaceId, input.userId, "person.deleted", {
        name: user?.name ?? "",
        ...deleted,
      });
      return { userId: input.userId, ...deleted };
    }),
});

// HR (people:manageStaff), never on the owner or yourself.
async function requireArchivable(user: SessionUser, workspaceId: string, userId: string) {
  await assertCanPeople(user, workspaceId, "people:manageStaff", { targetUserId: userId });
  const membership = await requireTargetMembership(workspaceId, userId);
  if (membership.role === "owner") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The workspace owner can't be archived" });
  }
  if (userId === user.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You can't archive yourself" });
  }
  return membership;
}

async function recordPersonChange(
  ctx: { user: SessionUser; ip: string | null },
  workspaceId: string,
  userId: string,
  verb: string,
  payload?: Record<string, unknown>,
) {
  await logActivity(workspaceId, ctx.user.id, "person", userId, verb, payload);
  await writeAudit({
    workspaceId,
    actorId: ctx.user.id,
    action: verb,
    entity: "person",
    entityId: userId,
    ip: ctx.ip,
    ...(payload ? { payload } : {}),
  });
}
