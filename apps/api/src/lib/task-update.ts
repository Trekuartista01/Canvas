import type { StatusKind, TaskPriority } from "@canvas/shared";
import { extractPlainText } from "./plain-text";

const COMPLETE_STATUS_KINDS = new Set<StatusKind>(["done", "closed"]);

/** Whether a status kind counts as "finished" a task — done or closed. */
export function isDoneKind(kind: StatusKind): boolean {
  return COMPLETE_STATUS_KINDS.has(kind);
}

/**
 * A status change into "done"/"closed" completes a task (for burndown);
 * moving back out to "open"/"active" un-completes it. Preserves an
 * already-set `completedAt` across a lateral move between two "complete"
 * kinds (e.g. done -> closed) rather than resetting the timestamp to now.
 * `now` is a parameter, not `new Date()` internally, for the same
 * testability reason `computeNextRunAt` takes one (see recurrence.ts).
 */
export function computeCompletedAt(
  newStatusKind: StatusKind,
  existingCompletedAt: Date | null,
  now: Date,
): Date | null {
  return COMPLETE_STATUS_KINDS.has(newStatusKind) ? (existingCompletedAt ?? now) : null;
}

/**
 * True only on the transition into "urgent" — not "stayed urgent across an
 * unrelated edit" (e.g. someone just changing the title of an already-
 * urgent task shouldn't re-broadcast to the whole workspace every time).
 * `newPriority` is `undefined` when the update didn't touch priority at
 * all, same "omitted vs. explicitly cleared" convention `buildTaskUpdateFields`
 * already uses.
 */
export function becameUrgent(
  oldPriority: TaskPriority | null,
  newPriority: TaskPriority | null | undefined,
): boolean {
  return newPriority === "urgent" && oldPriority !== "urgent";
}

/**
 * Builds the Drizzle `.set()` fields for a task update. Each field is
 * independently optional — a caller changing only `orderKey` (e.g. a
 * same-column drag reorder) must not silently drop that change just because
 * `statusId` didn't also change, and vice versa. `null` clears a nullable
 * field (e.g. removing a due date); `undefined` leaves it untouched.
 */
export function buildTaskUpdateFields(input: {
  title?: string;
  statusId?: string;
  orderKey?: string;
  descriptionJson?: unknown | null;
  priority?: TaskPriority | null;
  startDate?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  requiresProof?: boolean;
  isMilestone?: boolean;
  completedAt?: Date | null;
}) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.statusId !== undefined ? { statusId: input.statusId } : {}),
    ...(input.orderKey !== undefined ? { orderKey: input.orderKey } : {}),
    ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
    ...(input.descriptionJson !== undefined
      ? {
          descriptionJson: input.descriptionJson,
          // searchVector (Postgres generated column) reads this, not
          // descriptionJson directly — kept in lockstep with every write.
          descriptionText:
            input.descriptionJson === null ? null : extractPlainText(input.descriptionJson),
        }
      : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    ...(input.dueTime !== undefined ? { dueTime: input.dueTime } : {}),
    ...(input.requiresProof !== undefined ? { requiresProof: input.requiresProof } : {}),
    ...(input.isMilestone !== undefined ? { isMilestone: input.isMilestone } : {}),
  };
}
