import { db, schema } from "@canvas/db";
import {
  acceptInviteSchema,
  effectivePeopleRole,
  createWorkspaceSchema,
  inviteMemberSchema,
  listMembersSchema,
  removeMemberSchema,
  todayReportDate,
  updateMemberRoleSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { activeMembershipCondition, findMembership } from "../../lib/membership";
import { assertCan } from "../../lib/permissions";
import { isRoleVisibleInWorkspace } from "../../lib/space-overrides";
import { seedFixedHolidays } from "../../lib/working-days";
import { protectedProcedure, publicProcedure, router } from "../trpc";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "workspace"
  );
}

export const workspaceRouter = router({
  // Workspaces where the user is deactivated (M7.1) are left out entirely —
  // that's the "blocks login for that workspace" half the UI sees.
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        workspace: schema.workspaces,
        role: schema.memberships.role,
        storedPeopleRole: schema.memberships.peopleRole,
      })
      .from(schema.memberships)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
      .leftJoin(
        schema.employeeProfiles,
        eq(schema.employeeProfiles.membershipId, schema.memberships.id),
      )
      .where(and(eq(schema.memberships.userId, ctx.user.id), activeMembershipCondition));
    return rows.map(({ storedPeopleRole, ...row }) => ({
      ...row,
      peopleRole: effectivePeopleRole(row.role, storedPeopleRole),
    }));
  }),

  // Active members only — this feeds every member picker (assignees,
  // mentions, reports-to), which must not offer a deactivated member.
  members: protectedProcedure.input(listMembersSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "hierarchy:view");

    const rows = await db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        avatarUrl: schema.users.avatarUrl,
        role: schema.memberships.role,
        customRoleId: schema.memberships.customRoleId,
        customRoleName: schema.customRoles.name,
        storedPeopleRole: schema.memberships.peopleRole,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId))
      .leftJoin(
        schema.employeeProfiles,
        eq(schema.employeeProfiles.membershipId, schema.memberships.id),
      )
      .where(and(eq(schema.memberships.workspaceId, input.workspaceId), activeMembershipCondition));
    return rows.map(({ storedPeopleRole, ...row }) => ({
      ...row,
      peopleRole: effectivePeopleRole(row.role, storedPeopleRole),
    }));
  }),

  create: protectedProcedure.input(createWorkspaceSchema).mutation(async ({ ctx, input }) => {
    const base = slugify(input.name);
    let slug = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await db.query.workspaces.findFirst({
        where: eq(schema.workspaces.slug, slug),
      });
      if (!existing) break;
      slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ name: input.name, slug })
      .returning();
    if (!workspace) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await db.insert(schema.memberships).values({
      workspaceId: workspace.id,
      userId: ctx.user.id,
      role: "owner",
    });

    await db.insert(schema.activity).values({
      workspaceId: workspace.id,
      actorId: ctx.user.id,
      entityType: "workspace",
      entityId: workspace.id,
      verb: "workspace.created",
    });

    // M7.4: every workspace starts with Kosovo's fixed-date public holidays.
    await seedFixedHolidays(workspace.id, Number(todayReportDate(new Date()).slice(0, 4)));

    return workspace;
  }),

  invite: protectedProcedure.input(inviteMemberSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "workspace:invite");

    if (input.customRoleId) {
      const customRole = await db.query.customRoles.findFirst({
        where: and(
          eq(schema.customRoles.id, input.customRoleId),
          isNull(schema.customRoles.deletedAt),
        ),
      });
      if (!customRole) throw new TRPCError({ code: "NOT_FOUND", message: "Custom role not found" });
      if (!(await isRoleVisibleInWorkspace(customRole.createdBy, input.workspaceId))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Role isn't available in this workspace",
        });
      }
    }

    const [invite] = await db
      .insert(schema.invites)
      .values({
        workspaceId: input.workspaceId,
        email: input.email,
        role: input.role,
        customRoleId: input.customRoleId ?? null,
        invitedBy: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();
    if (!invite) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await db.insert(schema.activity).values({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      entityType: "invite",
      entityId: invite.id,
      verb: "invite.created",
    });

    // No email delivery yet (Phase 1 notifications). The caller surfaces the link.
    return invite;
  }),

  getInvite: publicProcedure.input(acceptInviteSchema).query(async ({ input }) => {
    const invite = await db.query.invites.findFirst({
      where: eq(schema.invites.id, input.inviteId),
    });
    if (!invite) throw new TRPCError({ code: "NOT_FOUND" });

    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, invite.workspaceId),
    });
    if (!workspace) throw new TRPCError({ code: "NOT_FOUND" });

    return {
      email: invite.email,
      role: invite.role,
      workspaceName: workspace.name,
      expired: invite.expiresAt.getTime() < Date.now(),
      accepted: invite.acceptedAt !== null,
    };
  }),

  acceptInvite: protectedProcedure.input(acceptInviteSchema).mutation(async ({ ctx, input }) => {
    const invite = await db.query.invites.findFirst({
      where: and(eq(schema.invites.id, input.inviteId), isNull(schema.invites.acceptedAt)),
    });
    if (!invite || invite.expiresAt.getTime() < Date.now()) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invite is invalid or expired" });
    }
    if (invite.email !== ctx.user.email) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This invite was sent to a different email address",
      });
    }

    // Raw lookup: a deactivated member re-accepting an old invite stays
    // deactivated rather than hitting the unique constraint.
    const existingMembership = await findMembership(invite.workspaceId, ctx.user.id);
    if (!existingMembership) {
      await db.insert(schema.memberships).values({
        workspaceId: invite.workspaceId,
        userId: ctx.user.id,
        role: invite.role,
        customRoleId: invite.customRoleId,
      });
    }

    await db
      .update(schema.invites)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invites.id, invite.id));

    await db.insert(schema.activity).values({
      workspaceId: invite.workspaceId,
      actorId: ctx.user.id,
      entityType: "membership",
      entityId: ctx.user.id,
      verb: "invite.accepted",
    });

    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, invite.workspaceId),
    });
    return workspace;
  }),

  updateMemberRole: protectedProcedure
    .input(updateMemberRoleSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCan(ctx.user, input.workspaceId, "workspace:manage");

      const targetRole = (await findMembership(input.workspaceId, input.userId))?.role;
      if (!targetRole) throw new TRPCError({ code: "NOT_FOUND" });
      if (targetRole === "owner") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The workspace owner's role can't be changed",
        });
      }

      await db
        .update(schema.memberships)
        .set({ role: input.role })
        .where(
          and(
            eq(schema.memberships.workspaceId, input.workspaceId),
            eq(schema.memberships.userId, input.userId),
          ),
        );

      await db.insert(schema.activity).values({
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        entityType: "membership",
        entityId: input.userId,
        verb: "membership.role_changed",
      });

      return { userId: input.userId, role: input.role };
    }),

  removeMember: protectedProcedure.input(removeMemberSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "workspace:manage");

    const targetRole = (await findMembership(input.workspaceId, input.userId))?.role;
    if (!targetRole) throw new TRPCError({ code: "NOT_FOUND" });
    if (targetRole === "owner") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The workspace owner can't be removed" });
    }

    await db
      .delete(schema.memberships)
      .where(
        and(
          eq(schema.memberships.workspaceId, input.workspaceId),
          eq(schema.memberships.userId, input.userId),
        ),
      );

    await db.insert(schema.activity).values({
      workspaceId: input.workspaceId,
      actorId: ctx.user.id,
      entityType: "membership",
      entityId: input.userId,
      verb: "membership.removed",
    });

    return { userId: input.userId };
  }),
});
