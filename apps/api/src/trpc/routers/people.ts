import { db, schema } from "@canvas/db";
import {
  createStaffSchema,
  effectivePeopleRole,
  PEOPLE_ACTIONS,
  peopleDirectorySchema,
  peopleMemberSchema,
  setEmployeeStatusSchema,
  setManagerSchema,
  setPeopleRoleSchema,
  updateEmployeeProfileSchema,
  WORKSPACE_ACTIONS,
  workspaceScopedSchema,
  wouldCreateReportingCycle,
  type EmployeeProfileFields,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { can } from "../../auth/can";
import type { SessionUser } from "../../auth/session";
import { hashPassword } from "../../auth/password";
import { logActivity } from "../../lib/activity";
import {
  activeMembershipCondition,
  findMembership,
  getMembershipContext,
  getMembershipRole,
  getPeopleContext,
} from "../../lib/membership";
import { assertCanPeople } from "../../lib/permissions";
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

  directory: protectedProcedure.input(peopleDirectorySchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:viewDirectory");
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

  profile: protectedProcedure.input(peopleMemberSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:viewProfile", {
      targetUserId: input.userId,
    });
    const membership = await requireTargetMembership(input.workspaceId, input.userId);
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

    const canManage = await canPeople(ctx.user, input.workspaceId, "people:manageStaff");
    // Contact/personal details only for HR-side roles and the person themselves.
    const showPersonal = canManage || input.userId === ctx.user.id;

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
      jobTitle: profile?.jobTitle ?? null,
      department: profile?.department ?? null,
      employmentStartDate: profile?.employmentStartDate ?? null,
      personal: showPersonal
        ? {
            phone: profile?.phone ?? null,
            address: profile?.address ?? null,
            dateOfBirth: profile?.dateOfBirth ?? null,
            emergencyContactName: profile?.emergencyContactName ?? null,
            emergencyContactPhone: profile?.emergencyContactPhone ?? null,
          }
        : null,
      canManage,
      canAssignSuperAdmin: await canPeople(ctx.user, input.workspaceId, "people:assignSuperAdmin"),
    };
  }),

  // HR creates the account directly; the new member signs in with the
  // initial password. An email that already has an account is refused —
  // attaching someone's existing account without their consent is exactly
  // what the invite flow (accepted by the account holder) is for.
  createStaff: protectedProcedure.input(createStaffSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff");
    if (input.peopleRole === "super_admin") {
      await assertCanPeople(ctx.user, input.workspaceId, "people:assignSuperAdmin");
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
      return { userId: input.userId };
    }),

  setRole: protectedProcedure.input(setPeopleRoleSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff", {
      targetUserId: input.userId,
    });
    const membership = await requireTargetMembership(input.workspaceId, input.userId);
    if (membership.role === "owner") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The workspace owner is always a super admin",
      });
    }
    if (input.peopleRole === "super_admin" || membership.peopleRole === "super_admin") {
      await assertCanPeople(ctx.user, input.workspaceId, "people:assignSuperAdmin");
    }

    await db
      .update(schema.memberships)
      .set({ peopleRole: input.peopleRole })
      .where(eq(schema.memberships.id, membership.id));
    await logActivity(
      input.workspaceId,
      ctx.user.id,
      "person",
      input.userId,
      "person.role_changed",
      {
        from: membership.peopleRole,
        to: input.peopleRole,
      },
    );
    return { userId: input.userId, peopleRole: input.peopleRole };
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

  // Deactivating keeps the membership and every bit of history; it only
  // blocks the member from the workspace (lib/membership.ts) and hides them
  // from pickers. Reactivating restores access as it was.
  setStatus: protectedProcedure.input(setEmployeeStatusSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "people:manageStaff", {
      targetUserId: input.userId,
    });
    const membership = await requireTargetMembership(input.workspaceId, input.userId);
    if (membership.role === "owner") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The workspace owner can't be deactivated",
      });
    }
    if (input.userId === ctx.user.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You can't deactivate yourself" });
    }
    if (membership.peopleRole === "super_admin") {
      await assertCanPeople(ctx.user, input.workspaceId, "people:assignSuperAdmin");
    }

    const inactive = input.status === "inactive";
    await upsertProfile(membership.id, {
      status: input.status,
      deactivatedAt: inactive ? new Date() : null,
    });
    await logActivity(
      input.workspaceId,
      ctx.user.id,
      "person",
      input.userId,
      inactive ? "person.deactivated" : "person.reactivated",
    );
    return { userId: input.userId, status: input.status };
  }),
});
