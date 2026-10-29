import { z } from "zod";

// contextId required for 'task' and 'doc'; omitted for 'global'. The DB
// enum still has 'channel' (Chat was removed in M7.0a); nothing creates it.
export const getOrCreateBrainConversationSchema = z.object({
  workspaceId: z.string().uuid(),
  contextType: z.enum(["task", "doc", "global"]),
  contextId: z.string().uuid().optional(),
});

export const listBrainMessagesSchema = z.object({
  conversationId: z.string().uuid(),
});

export const sendBrainMessageSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(8000),
  // Workspace-scoped AI reference attachments (images, files, videos).
  referenceAttachmentIds: z.array(z.string().uuid()).max(8).default([]),
});

export const setBrainConversationBrandKitSchema = z.object({
  conversationId: z.string().uuid(),
  brandKitId: z.string().uuid().nullable(),
});

// Same shape as getOrCreateBrainConversationSchema — newConversation always
// inserts a fresh row for this context instead of resuming one.
export const newBrainConversationSchema = getOrCreateBrainConversationSchema;

export const listBrainConversationsSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const deleteBrainConversationSchema = z.object({
  conversationId: z.string().uuid(),
});
