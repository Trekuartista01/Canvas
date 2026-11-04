import { db, schema } from "@canvas/db";
import {
  MAX_LOGO_BYTES,
  clientIdSchema,
  createClientSchema,
  defaultClientColor,
  listClientsSchema,
  presignClientLogoSchema,
  setClientArchivedSchema,
  updateClientSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { assertCanPeople } from "../../lib/permissions";
import { PRIVATE_PREFIXES, SIGNED_URL_TTL_SECONDS, presignPrivateUpload } from "../../lib/private-upload";
import { publish } from "../../lib/realtime";
import { deleteObject, getPresignedUrl, headObject } from "../../lib/storage";
import { protectedProcedure, router } from "../trpc";

async function requireClient(clientId: string) {
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client) throw new TRPCError({ code: "NOT_FOUND" });
  return client;
}

/** Two live clients with one name would make every chip ambiguous. */
async function assertNameFree(workspaceId: string, name: string, exceptId?: string) {
  const [taken] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.workspaceId, workspaceId),
        isNull(schema.clients.archivedAt),
        sql`lower(${schema.clients.name}) = lower(${name})`,
        exceptId ? sql`${schema.clients.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new TRPCError({ code: "CONFLICT", message: "There's already a client with that name" });
}

function cleanAliases(name: string, aliases: string[]) {
  const seen = new Set([name.toLowerCase()]);
  return aliases.filter((alias) => {
    const key = alias.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function announce(workspaceId: string, id: string, kind: "created" | "updated") {
  await publish(workspaceId, { entity: "client", id, workspaceId, kind });
}

async function withLogoUrl<T extends { logoKey: string | null }>(client: T) {
  const { logoKey, ...rest } = client;
  return {
    ...rest,
    hasLogo: Boolean(logoKey),
    logoUrl: logoKey ? await getPresignedUrl(logoKey, SIGNED_URL_TTL_SECONDS) : null,
  };
}

/**
 * P8.10 (spec §11): Ops, CEOs and Admin only (clients:manage). Not HR, not
 * employees. Linking a card to a client is task.setClient, because board
 * members see and change that on cards they already have.
 */
export const clientRouter = router({
  // The folders, with how many open cards each one holds.
  list: protectedProcedure.input(listClientsSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "clients:manage");
    const clients = await db
      .select()
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.workspaceId, input.workspaceId),
          input.includeArchived ? undefined : isNull(schema.clients.archivedAt),
        ),
      )
      .orderBy(asc(schema.clients.name));
    const ids = clients.map((c) => c.id);
    const open = ids.length
      ? await db
          .select({ clientId: schema.tasks.clientId, total: count() })
          .from(schema.tasks)
          .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
          .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
          .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
          .where(
            and(
              inArray(schema.tasks.clientId, ids),
              isNull(schema.tasks.deletedAt),
              isNull(schema.tasks.parentTaskId),
              isNull(schema.lists.deletedAt),
              isNull(schema.lists.archivedAt),
              isNull(schema.spaces.deletedAt),
              notInArray(schema.statuses.kind, ["done", "closed"]),
            ),
          )
          .groupBy(schema.tasks.clientId)
      : [];
    const openBy = new Map(open.map((o) => [o.clientId, o.total]));
    return Promise.all(
      clients.map(async (c) => ({ ...(await withLogoUrl(c)), openTasks: openBy.get(c.id) ?? 0 })),
    );
  }),

  // One folder: every card linked to this client, across all boards.
  folder: protectedProcedure.input(clientIdSchema).query(async ({ ctx, input }) => {
    const client = await requireClient(input.clientId);
    await assertCanPeople(ctx.user, client.workspaceId, "clients:manage");
    const tasks = await db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueDate: schema.tasks.dueDate,
        listId: schema.lists.id,
        listName: schema.lists.name,
        spaceId: schema.spaces.id,
        spaceName: schema.spaces.name,
        statusName: schema.statuses.name,
        statusKind: schema.statuses.kind,
        statusColor: schema.statuses.color,
      })
      .from(schema.tasks)
      .innerJoin(schema.statuses, eq(schema.statuses.id, schema.tasks.statusId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
      .where(
        and(
          eq(schema.tasks.clientId, client.id),
          isNull(schema.tasks.deletedAt),
          isNull(schema.tasks.parentTaskId),
          isNull(schema.lists.deletedAt),
          isNull(schema.lists.archivedAt),
          isNull(schema.spaces.deletedAt),
        ),
      )
      .orderBy(asc(schema.spaces.name), asc(schema.lists.name), asc(schema.tasks.createdAt));
    return { client: await withLogoUrl(client), tasks };
  }),

  // For the card's searchable dropdown.
  options: protectedProcedure.input(listClientsSchema).query(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "clients:manage");
    return db
      .select({ id: schema.clients.id, name: schema.clients.name, color: schema.clients.color })
      .from(schema.clients)
      .where(
        and(eq(schema.clients.workspaceId, input.workspaceId), isNull(schema.clients.archivedAt)),
      )
      .orderBy(asc(schema.clients.name));
  }),

  create: protectedProcedure.input(createClientSchema).mutation(async ({ ctx, input }) => {
    await assertCanPeople(ctx.user, input.workspaceId, "clients:manage");
    await assertNameFree(input.workspaceId, input.name);
    const [client] = await db
      .insert(schema.clients)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        aliases: cleanAliases(input.name, input.aliases),
        color: input.color ?? defaultClientColor(input.name),
        createdBy: ctx.user.id,
      })
      .returning();
    if (!client) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logActivity(input.workspaceId, ctx.user.id, "client", client.id, "client.created", {
      name: client.name,
    });
    await announce(input.workspaceId, client.id, "created");
    return { id: client.id, name: client.name, color: client.color };
  }),

  update: protectedProcedure.input(updateClientSchema).mutation(async ({ ctx, input }) => {
    const client = await requireClient(input.clientId);
    await assertCanPeople(ctx.user, client.workspaceId, "clients:manage");
    if (input.name !== undefined) await assertNameFree(client.workspaceId, input.name, client.id);

    if (input.logoKey) {
      // Only a key handed out for this client, and only a real, small image.
      const prefix = `${PRIVATE_PREFIXES.clientLogo}${client.workspaceId}/`;
      if (!input.logoKey.startsWith(prefix)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unexpected logo key" });
      }
      const head = await headObject(input.logoKey);
      if (!head) throw new TRPCError({ code: "BAD_REQUEST", message: "Upload did not complete" });
      if ((head.ContentLength ?? 0) > MAX_LOGO_BYTES) {
        await deleteObject(input.logoKey);
        throw new TRPCError({ code: "BAD_REQUEST", message: "Logos can be up to 5 MB" });
      }
    }

    const name = input.name ?? client.name;
    await db
      .update(schema.clients)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.aliases !== undefined ? { aliases: cleanAliases(name, input.aliases) } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.logoKey !== undefined ? { logoKey: input.logoKey } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.clients.id, client.id));
    if (input.logoKey !== undefined && client.logoKey && client.logoKey !== input.logoKey) {
      await deleteObject(client.logoKey);
    }
    await logActivity(client.workspaceId, ctx.user.id, "client", client.id, "client.updated", {
      name,
    });
    await announce(client.workspaceId, client.id, "updated");
    return { id: client.id };
  }),

  setArchived: protectedProcedure.input(setClientArchivedSchema).mutation(async ({ ctx, input }) => {
    const client = await requireClient(input.clientId);
    await assertCanPeople(ctx.user, client.workspaceId, "clients:manage");
    if (!input.archived) await assertNameFree(client.workspaceId, client.name, client.id);
    await db
      .update(schema.clients)
      .set({ archivedAt: input.archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.clients.id, client.id));
    await logActivity(
      client.workspaceId,
      ctx.user.id,
      "client",
      client.id,
      input.archived ? "client.archived" : "client.restored",
      { name: client.name },
    );
    await announce(client.workspaceId, client.id, "updated");
    return { id: client.id };
  }),

  presignLogo: protectedProcedure.input(presignClientLogoSchema).mutation(async ({ ctx, input }) => {
    const client = await requireClient(input.clientId);
    await assertCanPeople(ctx.user, client.workspaceId, "clients:manage");
    return presignPrivateUpload(PRIVATE_PREFIXES.clientLogo, {
      workspaceId: client.workspaceId,
      fileName: input.fileName,
      mime: input.mime,
    });
  }),
});
