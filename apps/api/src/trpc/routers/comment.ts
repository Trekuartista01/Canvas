import { db, schema } from "@canvas/db";
import {
  addReactionSchema,
  createCommentSchema,
  deleteCommentSchema,
  listCommentsSchema,
  removeReactionSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { validateCommentParent } from "../../lib/comment-thread";
import { extractMentionedUserIds } from "../../lib/mentions";
import { notifyUsers } from "../../lib/notify";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import { requireTask, workspaceIdForTask, spaceIdForTask } from "../../lib/task-queries";
import { protectedProcedure, router } from "../trpc";

async function requireComment(commentId: string) {
  const comment = await db.query.comments.findFirst({
    where: and(eq(schema.comments.id, commentId), isNull(schema.comments.deletedAt)),
  });
  if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
  return comment;
}

async function getReactions(commentIds: string[], currentUserId: string) {
  if (commentIds.length === 0)
    return new Map<string, { emoji: string; count: number; reactedByMe: boolean }[]>();

  const rows = await db
    .select({
      commentId: schema.reactions.commentId,
      emoji: schema.reactions.emoji,
      userId: schema.reactions.userId,
    })
    .from(schema.reactions)
    .where(inArray(schema.reactions.commentId, commentIds));

  const byComment = new Map<string, Map<string, { count: number; reactedByMe: boolean }>>();
  for (const row of rows) {
    const perEmoji = byComment.get(row.commentId) ?? new Map();
    const entry = perEmoji.get(row.emoji) ?? { count: 0, reactedByMe: false };
    entry.count += 1;
    if (row.userId === currentUserId) entry.reactedByMe = true;
    perEmoji.set(row.emoji, entry);
    byComment.set(row.commentId, perEmoji);
  }

  const result = new Map<string, { emoji: string; count: number; reactedByMe: boolean }[]>();
  for (const [commentId, perEmoji] of byComment) {
    result.set(
      commentId,
      [...perEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })),
    );
  }
  return result;
}

export const commentRouter = router({
  list: protectedProcedure.input(listCommentsSchema).query(async ({ ctx, input }) => {
    const workspaceId = await workspaceIdForTask(input.taskId);
    await assertCan(ctx.user, workspaceId, "comment:view", {
      spaceId: await spaceIdForTask(input.taskId),
    });

    const rows = await db
      .select({
        id: schema.comments.id,
        taskId: schema.comments.taskId,
        parentCommentId: schema.comments.parentCommentId,
        authorId: schema.comments.authorId,
        bodyJson: schema.comments.bodyJson,
        createdAt: schema.comments.createdAt,
        updatedAt: schema.comments.updatedAt,
        authorName: schema.users.name,
        authorAvatarUrl: schema.users.avatarUrl,
      })
      .from(schema.comments)
      .innerJoin(schema.users, eq(schema.users.id, schema.comments.authorId))
      .where(and(eq(schema.comments.taskId, input.taskId), isNull(schema.comments.deletedAt)))
      .orderBy(asc(schema.comments.createdAt));

    const reactionsByComment = await getReactions(
      rows.map((r) => r.id),
      ctx.user.id,
    );

    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      parentCommentId: r.parentCommentId,
      authorId: r.authorId,
      bodyJson: r.bodyJson,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      author: { id: r.authorId, name: r.authorName, avatarUrl: r.authorAvatarUrl },
      reactions: reactionsByComment.get(r.id) ?? [],
    }));
  }),

  create: protectedProcedure.input(createCommentSchema).mutation(async ({ ctx, input }) => {
    const task = await requireTask(input.taskId);
    const workspaceId = await workspaceIdForTask(task.id);
    await assertCan(ctx.user, workspaceId, "comment:create", {
      spaceId: await spaceIdForTask(task.id),
    });

    let parentCommentId: string | undefined;
    if (input.parentCommentId) {
      const parent = await requireComment(input.parentCommentId);
      const error = validateCommentParent(parent, input.taskId);
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });
      parentCommentId = parent.id;
    }

    const [comment] = await db
      .insert(schema.comments)
      .values({
        taskId: task.id,
        parentCommentId,
        authorId: ctx.user.id,
        bodyJson: input.bodyJson,
      })
      .returning();
    if (!comment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const activityRow = await logActivity(
      workspaceId,
      ctx.user.id,
      "comment",
      comment.id,
      "comment.created",
      { taskId: task.id, listId: task.listId },
    );
    await publish(workspaceId, {
      entity: "comment",
      id: comment.id,
      taskId: task.id,
      kind: "created",
    });

    const mentionedUserIds = extractMentionedUserIds(input.bodyJson).filter(
      (id) => id !== ctx.user.id,
    );
    if (mentionedUserIds.length > 0) {
      const members = await db
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.workspaceId, workspaceId),
            inArray(schema.memberships.userId, mentionedUserIds),
          ),
        );
      await notifyUsers(
        activityRow.id,
        members.map((m) => m.userId),
      );
    }

    return comment;
  }),

  delete: protectedProcedure.input(deleteCommentSchema).mutation(async ({ ctx, input }) => {
    const comment = await requireComment(input.commentId);
    const workspaceId = await workspaceIdForTask(comment.taskId);
    await assertCan(ctx.user, workspaceId, "comment:create", {
      spaceId: await spaceIdForTask(comment.taskId),
    });
    if (comment.authorId !== ctx.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own comments" });
    }

    await db
      .update(schema.comments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.comments.id, comment.id));

    await logActivity(workspaceId, ctx.user.id, "comment", comment.id, "comment.deleted");
    await publish(workspaceId, {
      entity: "comment",
      id: comment.id,
      taskId: comment.taskId,
      kind: "deleted",
    });
    return { id: comment.id };
  }),

  reactions: router({
    add: protectedProcedure.input(addReactionSchema).mutation(async ({ ctx, input }) => {
      const comment = await requireComment(input.commentId);
      const workspaceId = await workspaceIdForTask(comment.taskId);
      await assertCan(ctx.user, workspaceId, "comment:create", {
        spaceId: await spaceIdForTask(comment.taskId),
      });

      await db
        .insert(schema.reactions)
        .values({ commentId: comment.id, userId: ctx.user.id, emoji: input.emoji })
        .onConflictDoNothing();

      await logActivity(workspaceId, ctx.user.id, "comment", comment.id, "comment.reacted");
      await publish(workspaceId, {
        entity: "comment",
        id: comment.id,
        taskId: comment.taskId,
        kind: "updated",
      });
      return { ok: true as const };
    }),

    remove: protectedProcedure.input(removeReactionSchema).mutation(async ({ ctx, input }) => {
      const comment = await requireComment(input.commentId);
      const workspaceId = await workspaceIdForTask(comment.taskId);
      await assertCan(ctx.user, workspaceId, "comment:create", {
        spaceId: await spaceIdForTask(comment.taskId),
      });

      await db
        .delete(schema.reactions)
        .where(
          and(
            eq(schema.reactions.commentId, comment.id),
            eq(schema.reactions.userId, ctx.user.id),
            eq(schema.reactions.emoji, input.emoji),
          ),
        );

      await logActivity(workspaceId, ctx.user.id, "comment", comment.id, "comment.unreacted");
      await publish(workspaceId, {
        entity: "comment",
        id: comment.id,
        taskId: comment.taskId,
        kind: "updated",
      });
      return { ok: true as const };
    }),
  }),
});
