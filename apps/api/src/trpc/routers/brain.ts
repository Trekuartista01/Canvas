import { db, schema } from "@canvas/db";
import {
  deleteBrainConversationSchema,
  getOrCreateBrainConversationSchema,
  listBrainConversationsSchema,
  listBrainMessagesSchema,
  newBrainConversationSchema,
  sendBrainMessageSchema,
  setBrainConversationBrandKitSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { AiQuotaError, assertAiQuota } from "../../lib/ai-quota";
import { referenceContextSuffix, resolveAiReferences } from "../../lib/ai-references";
import { assertCan } from "../../lib/permissions";
import { requireTask, workspaceIdForTask } from "../../lib/task-queries";
import { brainQueue } from "../../queues/brain-queue";
import { protectedProcedure, router } from "../trpc";
import type { SessionUser } from "../../auth/session";

type ConversationContextInput = {
  workspaceId: string;
  contextType: "task" | "doc" | "global";
  contextId?: string;
};

// Shared by getOrCreateConversation and newConversation — both need the
// context (task/doc) to exist and belong to this workspace before a
// conversation can be opened against it.
async function validateConversationContext(user: SessionUser, input: ConversationContextInput) {
  await assertCan(user, input.workspaceId, "brain:view");

  if (input.contextType === "task") {
    if (!input.contextId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "contextId is required for task" });
    }
    const task = await requireTask(input.contextId);
    const taskWorkspaceId = await workspaceIdForTask(task.id);
    if (taskWorkspaceId !== input.workspaceId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Task does not belong to this workspace",
      });
    }
  }

  if (input.contextType === "doc") {
    if (!input.contextId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "contextId is required for doc" });
    }
    const doc = await db.query.docs.findFirst({
      where: and(eq(schema.docs.id, input.contextId), isNull(schema.docs.deletedAt)),
    });
    if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
    if (doc.workspaceId !== input.workspaceId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Doc does not belong to this workspace",
      });
    }
  }
}

async function requireConversation(conversationId: string) {
  const conversation = await db.query.brainConversations.findFirst({
    where: and(
      eq(schema.brainConversations.id, conversationId),
      isNull(schema.brainConversations.deletedAt),
    ),
  });
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND" });
  return conversation;
}

function activeConversationLookup(userId: string, input: ConversationContextInput) {
  return and(
    eq(schema.brainConversations.workspaceId, input.workspaceId),
    eq(schema.brainConversations.contextType, input.contextType),
    input.contextId
      ? eq(schema.brainConversations.contextId, input.contextId)
      : isNull(schema.brainConversations.contextId),
    eq(schema.brainConversations.createdBy, userId),
    eq(schema.brainConversations.isActive, true),
    isNull(schema.brainConversations.deletedAt),
  );
}

// Conversations are per-user (Ada's Brain chat about a task is private to
// Ada — see PROGRESS.md M2.2 decisions), so ownership is checked directly
// by id comparison rather than through can() — an ownership check, not a
// role decision, same pattern M1.7's comment.delete already established.
function assertOwnsConversation(userId: string, conversation: { createdBy: string }) {
  if (conversation.createdBy !== userId) throw new TRPCError({ code: "FORBIDDEN" });
}

export const brainRouter = router({
  getOrCreateConversation: protectedProcedure
    .input(getOrCreateBrainConversationSchema)
    .mutation(async ({ ctx, input }) => {
      await validateConversationContext(ctx.user, input);

      const lookup = activeConversationLookup(ctx.user.id, input);
      const existing = await db.query.brainConversations.findFirst({ where: lookup });
      if (existing) return existing;

      // Two concurrent calls (e.g. React StrictMode's double-invoked mount
      // effect) can both reach here with no existing row and both attempt
      // to insert — the partial unique indexes on brainConversations make
      // the loser's insert a no-op instead of a duplicate row, and it falls
      // back to fetching the winner's row instead of erroring.
      const [created] = await db
        .insert(schema.brainConversations)
        .values({
          workspaceId: input.workspaceId,
          contextType: input.contextType,
          contextId: input.contextId ?? null,
          createdBy: ctx.user.id,
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        await logActivity(
          input.workspaceId,
          ctx.user.id,
          "brain_conversation",
          created.id,
          "brain.conversation_created",
          { contextType: input.contextType, contextId: input.contextId ?? null },
        );
        return created;
      }

      const winner = await db.query.brainConversations.findFirst({ where: lookup });
      if (!winner) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return winner;
    }),

  // Starts a fresh conversation for this context instead of resuming the
  // active one — the old one isn't deleted, just no longer active, so it
  // stays in `list`'s history (see the schema's 2026-07-29 comment).
  newConversation: protectedProcedure
    .input(newBrainConversationSchema)
    .mutation(async ({ ctx, input }) => {
      await validateConversationContext(ctx.user, input);

      await db
        .update(schema.brainConversations)
        .set({ isActive: false })
        .where(activeConversationLookup(ctx.user.id, input));

      const [created] = await db
        .insert(schema.brainConversations)
        .values({
          workspaceId: input.workspaceId,
          contextType: input.contextType,
          contextId: input.contextId ?? null,
          createdBy: ctx.user.id,
        })
        .returning();
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        input.workspaceId,
        ctx.user.id,
        "brain_conversation",
        created.id,
        "brain.conversation_created",
        { contextType: input.contextType, contextId: input.contextId ?? null },
      );
      return created;
    }),

  // History: every non-deleted conversation this user has ever had in this
  // workspace, across every context, newest first — mirrors copywriter's
  // listMine/delete pattern. Conversations with zero messages (e.g. a
  // StrictMode double-mount's discarded duplicate — see the schema
  // comment) are left out; they're not meaningful history.
  list: protectedProcedure.input(listBrainConversationsSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "brain:view");

    const conversations = await db.query.brainConversations.findMany({
      where: and(
        eq(schema.brainConversations.workspaceId, input.workspaceId),
        eq(schema.brainConversations.createdBy, ctx.user.id),
        isNull(schema.brainConversations.deletedAt),
      ),
      orderBy: desc(schema.brainConversations.createdAt),
      limit: 100,
    });
    if (conversations.length === 0) return [];

    const firstMessages = await db.query.brainMessages.findMany({
      where: inArray(
        schema.brainMessages.conversationId,
        conversations.map((c) => c.id),
      ),
      orderBy: asc(schema.brainMessages.createdAt),
    });
    const previewByConversationId = new Map<string, string>();
    for (const m of firstMessages) {
      if (previewByConversationId.has(m.conversationId)) continue;
      const text = (m.contentJson as { text?: unknown } | null)?.text;
      previewByConversationId.set(
        m.conversationId,
        typeof text === "string" && text.trim() ? text.trim() : `(${m.role} message)`,
      );
    }

    return conversations
      .filter((c) => previewByConversationId.has(c.id))
      .map((c) => ({
        id: c.id,
        contextType: c.contextType,
        contextId: c.contextId,
        isActive: c.isActive,
        createdAt: c.createdAt,
        preview: previewByConversationId.get(c.id)!.slice(0, 140),
      }));
  }),

  delete: protectedProcedure
    .input(deleteBrainConversationSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await requireConversation(input.conversationId);
      assertOwnsConversation(ctx.user.id, conversation);

      await db
        .update(schema.brainConversations)
        .set({ deletedAt: new Date() })
        .where(eq(schema.brainConversations.id, conversation.id));

      await logActivity(
        conversation.workspaceId,
        ctx.user.id,
        "brain_conversation",
        conversation.id,
        "brain.conversation_deleted",
      );
      return { ok: true as const };
    }),

  // Attaches (or clears) a brand kit on an existing conversation — every
  // subsequent message picks it up via the worker's system-prompt build
  // (see worker.ts), not just messages sent after this call re-reads fresh
  // each time rather than snapshotting it into history.
  setBrandKit: protectedProcedure
    .input(setBrainConversationBrandKitSchema)
    .mutation(async ({ ctx, input }) => {
      const conversation = await requireConversation(input.conversationId);
      assertOwnsConversation(ctx.user.id, conversation);

      if (input.brandKitId) {
        const kit = await db.query.brandSettings.findFirst({
          where: and(
            eq(schema.brandSettings.id, input.brandKitId),
            eq(schema.brandSettings.workspaceId, conversation.workspaceId),
          ),
        });
        if (!kit) throw new TRPCError({ code: "NOT_FOUND", message: "Brand kit not found" });
      }

      const [updated] = await db
        .update(schema.brainConversations)
        .set({ brandKitId: input.brandKitId })
        .where(eq(schema.brainConversations.id, conversation.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return updated;
    }),

  messages: router({
    list: protectedProcedure.input(listBrainMessagesSchema).query(async ({ ctx, input }) => {
      const conversation = await requireConversation(input.conversationId);
      assertOwnsConversation(ctx.user.id, conversation);

      return db.query.brainMessages.findMany({
        where: eq(schema.brainMessages.conversationId, conversation.id),
        orderBy: asc(schema.brainMessages.createdAt),
      });
    }),

    send: protectedProcedure.input(sendBrainMessageSchema).mutation(async ({ ctx, input }) => {
      const conversation = await requireConversation(input.conversationId);
      assertOwnsConversation(ctx.user.id, conversation);
      await assertCan(ctx.user, conversation.workspaceId, "brain:chat");

      try {
        await assertAiQuota(ctx.user.id, "brain");
      } catch (err) {
        if (err instanceof AiQuotaError) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: err.message });
        }
        throw err;
      }

      const refs = await resolveAiReferences(
        conversation.workspaceId,
        input.referenceAttachmentIds,
      );
      const text = `${input.text}${referenceContextSuffix(refs)}`;
      const imageVersionIds = refs
        .map((r) => r.imageVersionId)
        .filter((id): id is string => typeof id === "string");

      await db.insert(schema.brainMessages).values({
        conversationId: conversation.id,
        role: "user",
        contentJson: {
          text,
          attachments: refs.map((r) => ({
            id: r.attachmentId,
            fileName: r.fileName,
            mime: r.mime,
          })),
        },
        imageVersionIds: imageVersionIds.length > 0 ? imageVersionIds : null,
      });

      await logActivity(
        conversation.workspaceId,
        ctx.user.id,
        "brain_conversation",
        conversation.id,
        "brain.message_sent",
      );

      // The actual Claude call happens in the worker, never here — CLAUDE.md
      // hard rule: "All external AI calls... run in BullMQ workers — never
      // in request handlers."
      await brainQueue.add("chat", {
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
        userId: ctx.user.id,
      });

      return { ok: true };
    }),
  }),
});
