// "review" (M7.2) = awaiting approval: between active and done in the task
// lifecycle (pending → in progress → awaiting approval → completed).
export const STATUS_KINDS = ["open", "active", "review", "done", "closed"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];
