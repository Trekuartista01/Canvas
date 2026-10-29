// Kept separate from the db pgEnum and hand-synced, matching the existing
// STATUS_KINDS/MEMBERSHIP_ROLES pattern. The DB enum has all four contexts
// DATA_MODEL.md specifies; the tRPC-facing schema (schemas/brain.ts)
// restricts to the contexts the app actually builds — see PROGRESS.md
// (M7.0a removed Chat, so 'channel' is DB-only now).
export const BRAIN_CONTEXT_TYPES = ["task", "doc", "channel", "global"] as const;
export type BrainContextType = (typeof BRAIN_CONTEXT_TYPES)[number];
