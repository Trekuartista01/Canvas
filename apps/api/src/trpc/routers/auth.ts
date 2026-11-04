import { recordRoleRequest } from "../../lib/role-requests";
import { db, schema } from "@canvas/db";
import {
  deleteAccountSchema,
  logInSchema,
  signUpSchema,
  updateProfileSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { clearSessionCookie, setSessionCookie } from "../../auth/cookies";
import { hashPassword, verifyPassword } from "../../auth/password";
import { createSession, invalidateSession } from "../../auth/session";
import { assertAuthRateLimit, clientIp, RateLimitError } from "../../lib/rate-limit";
import { publicProcedure, protectedProcedure, router } from "../trpc";

function tooManyRequests(): never {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Too many attempts. Try again in a minute.",
  });
}

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  signUp: publicProcedure.input(signUpSchema).mutation(async ({ ctx, input }) => {
    try {
      await assertAuthRateLimit(clientIp(ctx.req));
    } catch (err) {
      if (err instanceof RateLimitError) tooManyRequests();
      throw err;
    }

    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, input.email),
    });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
    }

    const passwordHash = await hashPassword(input.password);
    const [user] = await db
      .insert(schema.users)
      .values({ email: input.email, name: input.name, passwordHash })
      .returning();
    if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    if (input.inviteId) {
      const invite = await db.query.invites.findFirst({
        where: and(
          eq(schema.invites.id, input.inviteId),
          eq(schema.invites.email, input.email),
          isNull(schema.invites.acceptedAt),
        ),
      });
      if (invite && invite.expiresAt.getTime() > Date.now()) {
        await db.insert(schema.memberships).values({
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role,
        });
        await db
          .update(schema.invites)
          .set({ acceptedAt: new Date() })
          .where(eq(schema.invites.id, invite.id));
        await db.insert(schema.activity).values({
          workspaceId: invite.workspaceId,
          actorId: user.id,
          entityType: "membership",
          entityId: user.id,
          verb: "invite.accepted",
        });
        if (input.requestedRole) {
          await recordRoleRequest(invite.workspaceId, user.id, input.requestedRole);
        }
      }
    }

    const session = await createSession(user.id);
    setSessionCookie(ctx.res, session.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      title: user.title,
    };
  }),

  logIn: publicProcedure.input(logInSchema).mutation(async ({ ctx, input }) => {
    try {
      await assertAuthRateLimit(clientIp(ctx.req), input.email);
    } catch (err) {
      if (err instanceof RateLimitError) tooManyRequests();
      throw err;
    }

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, input.email),
    });
    if (!user || !user.passwordHash) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const session = await createSession(user.id);
    setSessionCookie(ctx.res, session.id);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      title: user.title,
    };
  }),

  logOut: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionId) {
      await invalidateSession(ctx.sessionId);
    }
    clearSessionCookie(ctx.res);
    return { ok: true as const };
  }),

  // Self-only, no can() check — same "user-level, not workspace-scoped"
  // reasoning as deleteAccount below. No logActivity call either, for the
  // same structural reason deleteAccount has none: activity.workspaceId is
  // NOT NULL and every activity feed is workspace-scoped, but a profile
  // edit has no single owning workspace to attribute it to.
  updateProfile: protectedProcedure.input(updateProfileSchema).mutation(async ({ ctx, input }) => {
    const [user] = await db
      .update(schema.users)
      .set({
        name: input.name,
        bio: input.bio || null,
        title: input.title || null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, ctx.user.id))
      .returning();
    if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      title: user.title,
    };
  }),

  // Real erasure, not a soft-delete — `users` has no deletedAt column (it
  // never needed one before this), and a privacy-policy "right to erasure"
  // is expected to actually remove personal data, not just hide it while
  // the email/password hash sit around forever. Every table with a
  // required (not-null) FK to users.id already cascades on delete
  // (sessions, memberships, etc.); tables that instead want to keep
  // content after its creator is gone already model that FK as nullable
  // with onDelete: "set null" (e.g. tasks.createdBy) — this mutation
  // relies entirely on those existing, already-reviewed per-table choices
  // rather than re-deciding cascade behavior here.
  deleteAccount: protectedProcedure.input(deleteAccountSchema).mutation(async ({ ctx, input }) => {
    if (input.confirmEmail.trim().toLowerCase() !== ctx.user.email.toLowerCase()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Email confirmation didn't match your account email.",
      });
    }

    // Deleting an owner's account would leave any workspace they own
    // without one — memberships cascade away with the user, but the
    // workspace and its other members/content stay behind, ownerless.
    // Block until ownership is transferred (Members settings) or the
    // workspace itself is deleted.
    const ownedWorkspaces = await db
      .select({ name: schema.workspaces.name })
      .from(schema.memberships)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
      .where(and(eq(schema.memberships.userId, ctx.user.id), eq(schema.memberships.role, "owner")));
    if (ownedWorkspaces.length > 0) {
      const names = ownedWorkspaces.map((w) => w.name).join(", ");
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `You own ${ownedWorkspaces.length === 1 ? "a workspace" : "workspaces"} (${names}) — make someone else the owner from Members settings, or delete the workspace, before deleting your account.`,
      });
    }

    await db.delete(schema.users).where(eq(schema.users.id, ctx.user.id));
    clearSessionCookie(ctx.res);
    return { ok: true as const };
  }),
});
