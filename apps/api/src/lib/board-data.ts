import { db, schema } from "@canvas/db";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";

/** A card's front needs these per task: one grouped query each, not one per card. */
function byTask<T>(rows: (T & { taskId: string })[]) {
  const map = new Map<string, T[]>();
  for (const { taskId, ...rest } of rows) {
    const list = map.get(taskId) ?? [];
    list.push(rest as unknown as T);
    map.set(taskId, list);
  }
  return map;
}

/** P8.9: one board's lists and the card fronts on them. */
export async function loadBoard(spaceId: string) {
  const liveCard = and(
    eq(schema.lists.spaceId, spaceId),
    isNull(schema.lists.deletedAt),
    isNull(schema.lists.archivedAt),
    isNull(schema.tasks.deletedAt),
    isNull(schema.tasks.parentTaskId),
  );

  const [lists, cards, assignees, tags, comments, attachments, checklists] = await Promise.all([
    db
      .select({
        id: schema.lists.id,
        name: schema.lists.name,
        orderKey: schema.lists.orderKey,
        archivedAt: schema.lists.archivedAt,
      })
      .from(schema.lists)
      .where(and(eq(schema.lists.spaceId, spaceId), isNull(schema.lists.deletedAt)))
      .orderBy(sql`${schema.lists.orderKey} COLLATE "C"`),
    db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        listId: schema.tasks.listId,
        orderKey: schema.tasks.orderKey,
        dueDate: schema.tasks.dueDate,
        statusKind: schema.statuses.kind,
        clientId: schema.clients.id,
        clientName: schema.clients.name,
        clientColor: schema.clients.color,
      })
      .from(schema.tasks)
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
      .leftJoin(schema.clients, eq(schema.clients.id, schema.tasks.clientId))
      .where(liveCard)
      .orderBy(asc(schema.tasks.createdAt)),
    db
      .select({
        taskId: schema.taskAssignees.taskId,
        userId: schema.users.id,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
      })
      .from(schema.taskAssignees)
      .innerJoin(schema.users, eq(schema.users.id, schema.taskAssignees.userId))
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskAssignees.taskId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .where(liveCard),
    db
      .select({
        taskId: schema.taskTags.taskId,
        id: schema.tags.id,
        name: schema.tags.name,
        color: schema.tags.color,
      })
      .from(schema.taskTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.taskTags.tagId))
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskTags.taskId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .where(liveCard),
    db
      .select({ taskId: schema.comments.taskId, total: count() })
      .from(schema.comments)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.comments.taskId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .where(and(liveCard, isNull(schema.comments.deletedAt)))
      .groupBy(schema.comments.taskId),
    db
      .select({ taskId: schema.attachments.taskId, total: count() })
      .from(schema.attachments)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attachments.taskId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .where(liveCard)
      .groupBy(schema.attachments.taskId),
    db
      .select({
        taskId: schema.checklists.taskId,
        total: count(),
        done: sql<number>`count(*) filter (where ${schema.checklistItems.done})`.mapWith(Number),
      })
      .from(schema.checklistItems)
      .innerJoin(schema.checklists, eq(schema.checklists.id, schema.checklistItems.checklistId))
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.checklists.taskId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .where(liveCard)
      .groupBy(schema.checklists.taskId),
  ]);

  const assigneesByTask = byTask(assignees);
  const tagsByTask = byTask(tags);
  const commentCount = new Map(comments.map((c) => [c.taskId, c.total]));
  const attachmentCount = new Map(attachments.map((a) => [a.taskId, a.total]));
  const checklistByTask = new Map(checklists.map((c) => [c.taskId, c]));

  return {
    lists: lists.filter((l) => !l.archivedAt).map(({ archivedAt: _archived, ...l }) => l),
    archivedLists: lists.filter((l) => l.archivedAt).map(({ id, name }) => ({ id, name })),
    cards: cards.map(({ clientId, clientName, clientColor, ...card }) => {
      const checklist = checklistByTask.get(card.id);
      return {
        ...card,
        client:
          clientId && clientName && clientColor
            ? { id: clientId, name: clientName, color: clientColor }
            : null,
        assignees: assigneesByTask.get(card.id) ?? [],
        tags: tagsByTask.get(card.id) ?? [],
        comments: commentCount.get(card.id) ?? 0,
        attachments: attachmentCount.get(card.id) ?? 0,
        checklistDone: checklist?.done ?? 0,
        checklistTotal: checklist?.total ?? 0,
      };
    }),
  };
}
