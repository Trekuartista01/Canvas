import { db, schema } from "@canvas/db";
import type { StatusKind } from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { requireList, requireSpace } from "./hierarchy";

export async function requireTask(taskId: string) {
  const task = await db.query.tasks.findFirst({
    where: and(eq(schema.tasks.id, taskId), isNull(schema.tasks.deletedAt)),
  });
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  return task;
}

export async function workspaceIdForList(listId: string) {
  const list = await requireList(listId);
  const space = await requireSpace(list.spaceId);
  return space.workspaceId;
}

export async function workspaceIdForTask(taskId: string) {
  const task = await requireTask(taskId);
  return workspaceIdForList(task.listId);
}

// Phase 6: per-space permission overrides. Cheaper than workspaceIdForList
// (no join to spaces needed) since lists already carry their own spaceId.
export async function spaceIdForList(listId: string) {
  const list = await requireList(listId);
  return list.spaceId;
}

export async function spaceIdForTask(taskId: string) {
  const task = await requireTask(taskId);
  return spaceIdForList(task.listId);
}

// Extracted from trpc/routers/task.ts (M1.2) so the scheduler worker (M3.5:
// spawning a recurring task) can place a new task the same way task.create
// does, without duplicating the logic.
export async function firstStatusForList(listId: string) {
  const status = await db.query.statuses.findFirst({
    where: eq(schema.statuses.listId, listId),
    orderBy: asc(schema.statuses.orderKey),
  });
  if (!status) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This list has no statuses yet" });
  }
  return status;
}

// A list's own notion of "the" done status, for flows that mark a task
// finished without letting the caller pick among possibly-several
// done/closed statuses (e.g. "Done" vs "Archived") — the Home page's
// quick-complete checkbox and a task-bound public form's submission.
export async function firstDoneStatusForList(listId: string) {
  const status = await db.query.statuses.findFirst({
    where: and(
      eq(schema.statuses.listId, listId),
      or(eq(schema.statuses.kind, "done"), eq(schema.statuses.kind, "closed")),
    ),
    orderBy: asc(schema.statuses.orderKey),
  });
  if (!status) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This list has no done status to complete into",
    });
  }
  return status;
}

export async function lastTaskOrderKey(listId: string, statusId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.tasks.orderKey })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.listId, listId),
        eq(schema.tasks.statusId, statusId),
        isNull(schema.tasks.deletedAt),
      ),
    )
    .orderBy(desc(schema.tasks.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

// M7.2: the status submit/reject move a task into — the list's first status
// of that kind, or null if it has none (a pre-M7.2 list with no review).
export async function firstStatusOfKind(listId: string, kind: StatusKind) {
  const status = await db.query.statuses.findFirst({
    where: and(eq(schema.statuses.listId, listId), eq(schema.statuses.kind, kind)),
    orderBy: asc(schema.statuses.orderKey),
  });
  return status ?? null;
}
