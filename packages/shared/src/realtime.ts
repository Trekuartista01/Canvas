import { z } from "zod";

// ARCHITECTURE.md: "server emits { entity: 'task', id, listId, kind:
// 'updated' }; clients invalidate queries. No payloads over WS in Phase 1."
// A discriminated union so each entity carries only the scoping id its
// invalidation actually needs — comments/checklists scope by taskId,
// not listId.
export const REALTIME_KINDS = ["created", "updated", "deleted"] as const;

const kind = z.enum(REALTIME_KINDS);

export const realtimeEventSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("task"), id: z.string().uuid(), listId: z.string().uuid(), kind }),
  z.object({
    entity: z.literal("status"),
    id: z.string().uuid(),
    listId: z.string().uuid(),
    kind,
  }),
  z.object({
    entity: z.literal("comment"),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    kind,
  }),
  // Covers both a checklist itself and its items — both map to the same
  // client invalidation (`checklist.list`, which returns checklists nested
  // with their items in one query).
  z.object({
    entity: z.literal("checklist"),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    kind,
  }),
  // Sidebar tree changes (space/folder/list create/rename/delete) — one
  // shared entity for all three since every client invalidation is the same
  // blanket `hierarchy.tree` refetch regardless of which level changed.
  z.object({
    entity: z.literal("hierarchy"),
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind,
  }),
  // Tag definitions are workspace-scoped (tag.list takes workspaceId, not a
  // list/task id) — create/delete on one client left every other connected
  // client's tag picker stale until a manual refetch.
  z.object({
    entity: z.literal("tag"),
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind,
  }),
  // Custom field defs are workspace-scoped, not list-scoped — a def with a
  // null listId applies to every list in the workspace, so there's no single
  // listId every def change can be tagged with. Clients invalidate every
  // customField.defs.list query regardless of which list it was cached for.
  z.object({
    entity: z.literal("customFieldDef"),
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind,
  }),
  // Custom field values are per-task (customField.values.listForTask takes
  // taskId) — a separate entity from customFieldDef since defs and values
  // invalidate different queries.
  z.object({
    entity: z.literal("customFieldValue"),
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    kind,
  }),
  // M7.3: a daily report was saved or read — refreshes the team view, the
  // author's history and the "Read by" list.
  z.object({
    entity: z.literal("dailyReport"),
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind,
  }),
  // M7.5: a leave request was made, decided, cancelled or recorded (or a
  // balance changed) — refreshes balances, approvals and who's-off.
  z.object({
    entity: z.literal("leave"),
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind,
  }),
  // M7.7: a payroll record changed. Invalidation only — never any payroll
  // values over the socket.
  z.object({
    entity: z.literal("payroll"),
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    kind,
  }),
]);

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

// A separate WS channel (/ws/brain?conversationId=...), not the workspace
// board-invalidation channel above — Phase 1's realtime protocol is
// deliberately payload-free ("no payloads over WS in Phase 1"); brain chat
// needs to carry actual message text, which is a genuinely different
// concern with its own connection lifecycle (open only while a chat panel
// is mounted, vs. the board channel's whole-session connection). See
// PROGRESS.md (M2.2 decisions).
//
// M2.3 extends this with tool/image status events so the chat UI can show
// queued → generating → done without polling.
export const brainStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done"), messageId: z.string().uuid() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({
    type: z.literal("tool_status"),
    name: z.string(),
    status: z.enum(["running", "done", "error"]),
    toolUseId: z.string(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("image_status"),
    status: z.enum(["queued", "generating", "done", "error"]),
    assetId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
    toolUseId: z.string().optional(),
    message: z.string().optional(),
  }),
]);

export type BrainStreamEvent = z.infer<typeof brainStreamEventSchema>;

// Generation UX / edit loop (M2.5): live job status for an image_asset,
// separate from brain chat's conversation-scoped stream.
export const imageAssetJobEventSchema = z.object({
  status: z.enum(["queued", "generating", "done", "error"]),
  assetId: z.string().uuid(),
  versionId: z.string().uuid().optional(),
  kind: z.enum(["generate", "edit"]).optional(),
  message: z.string().optional(),
});

export type ImageAssetJobEvent = z.infer<typeof imageAssetJobEventSchema>;

// Copywriter (Collaborate section): live job status for a copy_generations
// row, same "own WS channel keyed by the row's own id" shape as
// imageAssetJobEventSchema above — a generate/refine call can take a few
// seconds (a real Claude round trip), so the UI needs queued -> generating
// -> done/error without polling, not just a generic board invalidation.
export const copyGenerationJobEventSchema = z.object({
  status: z.enum(["queued", "generating", "done", "error"]),
  generationId: z.string().uuid(),
  message: z.string().optional(),
});

export type CopyGenerationJobEvent = z.infer<typeof copyGenerationJobEventSchema>;
