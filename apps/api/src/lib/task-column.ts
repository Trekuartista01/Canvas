import { db, schema } from "@canvas/db";
import {
  columnForStatusKind,
  columnStatusKind,
  statusForMove,
  type StatusKind,
} from "@canvas/shared";
import { and, asc, eq, isNull } from "drizzle-orm";

/**
 * Where a card goes when its status changes to `kind`: the board column for
 * that status. Null when it stays put: a subtask (it follows its card), a card
 * in a column of the team's own that isn't about status, or no matching column.
 */
export async function columnMoveForStatus(
  task: { listId: string; parentTaskId: string | null },
  kind: StatusKind,
): Promise<{ listId: string; statusId: string } | null> {
  if (task.parentTaskId) return null;
  const current = await db.query.lists.findFirst({ where: eq(schema.lists.id, task.listId) });
  if (!current || !columnStatusKind(current.name)) return null;
  const columns = await db
    .select({ id: schema.lists.id, name: schema.lists.name })
    .from(schema.lists)
    .where(
      and(
        eq(schema.lists.spaceId, current.spaceId),
        isNull(schema.lists.archivedAt),
        isNull(schema.lists.deletedAt),
      ),
    )
    .orderBy(asc(schema.lists.orderKey));
  const target = columnForStatusKind(columns, kind);
  if (!target || target.id === current.id) return null;
  // The current column already means this status (Done holds done and closed).
  if (columnStatusKind(current.name) === columnStatusKind(target.name)) return null;
  const statuses = await targetStatuses(target.id);
  const status = statuses.find((s) => s.kind === kind);
  return status ? { listId: target.id, statusId: status.id } : null;
}

function targetStatuses(listId: string) {
  return db
    .select({ id: schema.statuses.id, kind: schema.statuses.kind })
    .from(schema.statuses)
    .where(eq(schema.statuses.listId, listId))
    .orderBy(asc(schema.statuses.orderKey));
}

/** Subtasks stay with their card, each keeping its kind of status. */
export async function moveSubtasksWithCard(taskId: string, listId: string) {
  const subtasks = await db
    .select({ id: schema.tasks.id, kind: schema.statuses.kind })
    .from(schema.tasks)
    .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
    .where(and(eq(schema.tasks.parentTaskId, taskId), isNull(schema.tasks.deletedAt)));
  if (subtasks.length === 0) return;
  const statuses = await targetStatuses(listId);
  for (const subtask of subtasks) {
    await db
      .update(schema.tasks)
      .set({
        listId,
        statusId: statusForMove(statuses, subtask.kind)!.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, subtask.id));
  }
}
