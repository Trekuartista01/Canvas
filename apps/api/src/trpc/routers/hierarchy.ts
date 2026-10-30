import { db, schema } from "@canvas/db";
import {
  createFolderSchema,
  createListSchema,
  createSpaceSchema,
  deleteFolderSchema,
  deleteListSchema,
  deleteSpaceSchema,
  listSpacesSchema,
  STATUS_KINDS,
  updateFolderSchema,
  updateListSchema,
  updateSpaceSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { requireList, requireSpace } from "../../lib/hierarchy";
import { nextOrderKey } from "../../lib/order";
import { assertCan } from "../../lib/permissions";
import { publish } from "../../lib/realtime";
import { protectedProcedure, router } from "../trpc";

async function requireFolder(folderId: string) {
  const folder = await db.query.folders.findFirst({
    where: and(eq(schema.folders.id, folderId), isNull(schema.folders.deletedAt)),
  });
  if (!folder) throw new TRPCError({ code: "NOT_FOUND" });
  return folder;
}

async function lastSpaceOrderKey(workspaceId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.spaces.orderKey })
    .from(schema.spaces)
    .where(and(eq(schema.spaces.workspaceId, workspaceId), isNull(schema.spaces.deletedAt)))
    .orderBy(desc(schema.spaces.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

async function lastFolderOrderKey(spaceId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.folders.orderKey })
    .from(schema.folders)
    .where(and(eq(schema.folders.spaceId, spaceId), isNull(schema.folders.deletedAt)))
    .orderBy(desc(schema.folders.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

async function lastListOrderKey(spaceId: string): Promise<string | null> {
  const [last] = await db
    .select({ orderKey: schema.lists.orderKey })
    .from(schema.lists)
    .where(and(eq(schema.lists.spaceId, spaceId), isNull(schema.lists.deletedAt)))
    .orderBy(desc(schema.lists.orderKey))
    .limit(1);
  return last?.orderKey ?? null;
}

// M7.2 lifecycle: pending → in progress → awaiting approval → completed.
const DEFAULT_STATUSES: { name: string; color: string; kind: (typeof STATUS_KINDS)[number] }[] = [
  { name: "Pending", color: "#94a3b8", kind: "open" },
  { name: "In progress", color: "#3b82f6", kind: "active" },
  { name: "Awaiting approval", color: "#f59e0b", kind: "review" },
  { name: "Completed", color: "#22c55e", kind: "done" },
];

export const hierarchyRouter = router({
  tree: protectedProcedure.input(listSpacesSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "hierarchy:view");

    const [spaceRows, folderRows, listRows] = await Promise.all([
      db
        .select()
        .from(schema.spaces)
        .where(
          and(eq(schema.spaces.workspaceId, input.workspaceId), isNull(schema.spaces.deletedAt)),
        )
        .orderBy(asc(schema.spaces.orderKey)),
      db
        .select({ folder: schema.folders })
        .from(schema.folders)
        .innerJoin(schema.spaces, eq(schema.spaces.id, schema.folders.spaceId))
        .where(
          and(eq(schema.spaces.workspaceId, input.workspaceId), isNull(schema.folders.deletedAt)),
        )
        .orderBy(asc(schema.folders.orderKey)),
      db
        .select({ list: schema.lists })
        .from(schema.lists)
        .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
        .where(
          and(eq(schema.spaces.workspaceId, input.workspaceId), isNull(schema.lists.deletedAt)),
        )
        .orderBy(asc(schema.lists.orderKey)),
    ]);

    return {
      spaces: spaceRows,
      folders: folderRows.map((r) => r.folder),
      lists: listRows.map((r) => r.list),
    };
  }),

  space: router({
    create: protectedProcedure.input(createSpaceSchema).mutation(async ({ ctx, input }) => {
      await assertCan(ctx.user, input.workspaceId, "hierarchy:create");

      const lastKey = await lastSpaceOrderKey(input.workspaceId);

      const [space] = await db
        .insert(schema.spaces)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          icon: input.icon ?? null,
          orderKey: nextOrderKey(lastKey),
        })
        .returning();
      if (!space) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(input.workspaceId, ctx.user.id, "space", space.id, "space.created");
      await publish(input.workspaceId, {
        entity: "hierarchy",
        id: space.id,
        workspaceId: input.workspaceId,
        kind: "created",
      });
      return space;
    }),

    update: protectedProcedure.input(updateSpaceSchema).mutation(async ({ ctx, input }) => {
      const space = await requireSpace(input.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:update", { spaceId: space.id });

      const [updated] = await db
        .update(schema.spaces)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.brandKitId !== undefined ? { brandKitId: input.brandKitId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.spaces.id, input.spaceId))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(space.workspaceId, ctx.user.id, "space", space.id, "space.updated");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: space.id,
        workspaceId: space.workspaceId,
        kind: "updated",
      });
      return updated;
    }),

    delete: protectedProcedure.input(deleteSpaceSchema).mutation(async ({ ctx, input }) => {
      const space = await requireSpace(input.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:delete", { spaceId: space.id });

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(schema.spaces)
          .set({ deletedAt: now })
          .where(eq(schema.spaces.id, space.id));
        await tx
          .update(schema.folders)
          .set({ deletedAt: now })
          .where(eq(schema.folders.spaceId, space.id));
        await tx
          .update(schema.lists)
          .set({ deletedAt: now })
          .where(eq(schema.lists.spaceId, space.id));
      });

      await logActivity(space.workspaceId, ctx.user.id, "space", space.id, "space.deleted");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: space.id,
        workspaceId: space.workspaceId,
        kind: "deleted",
      });
      return { id: space.id };
    }),
  }),

  folder: router({
    create: protectedProcedure.input(createFolderSchema).mutation(async ({ ctx, input }) => {
      const space = await requireSpace(input.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:create", { spaceId: space.id });

      const lastKey = await lastFolderOrderKey(input.spaceId);

      const [folder] = await db
        .insert(schema.folders)
        .values({ spaceId: input.spaceId, name: input.name, orderKey: nextOrderKey(lastKey) })
        .returning();
      if (!folder) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(space.workspaceId, ctx.user.id, "folder", folder.id, "folder.created");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: folder.id,
        workspaceId: space.workspaceId,
        kind: "created",
      });
      return folder;
    }),

    update: protectedProcedure.input(updateFolderSchema).mutation(async ({ ctx, input }) => {
      const folder = await requireFolder(input.folderId);
      const space = await requireSpace(folder.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:update", { spaceId: space.id });

      const [updated] = await db
        .update(schema.folders)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(schema.folders.id, input.folderId))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(space.workspaceId, ctx.user.id, "folder", folder.id, "folder.updated");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: folder.id,
        workspaceId: space.workspaceId,
        kind: "updated",
      });
      return updated;
    }),

    delete: protectedProcedure.input(deleteFolderSchema).mutation(async ({ ctx, input }) => {
      const folder = await requireFolder(input.folderId);
      const space = await requireSpace(folder.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:delete", { spaceId: space.id });

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(schema.folders)
          .set({ deletedAt: now })
          .where(eq(schema.folders.id, folder.id));
        await tx
          .update(schema.lists)
          .set({ deletedAt: now })
          .where(eq(schema.lists.folderId, folder.id));
      });

      await logActivity(space.workspaceId, ctx.user.id, "folder", folder.id, "folder.deleted");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: folder.id,
        workspaceId: space.workspaceId,
        kind: "deleted",
      });
      return { id: folder.id };
    }),
  }),

  list: router({
    create: protectedProcedure.input(createListSchema).mutation(async ({ ctx, input }) => {
      const space = await requireSpace(input.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:create", { spaceId: space.id });

      if (input.folderId) {
        const folder = await requireFolder(input.folderId);
        if (folder.spaceId !== input.spaceId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Folder does not belong to this space",
          });
        }
      }

      const lastKey = await lastListOrderKey(input.spaceId);

      const list = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.lists)
          .values({
            spaceId: input.spaceId,
            folderId: input.folderId ?? null,
            name: input.name,
            orderKey: nextOrderKey(lastKey),
          })
          .returning();
        if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        let statusOrderKey: string | null = null;
        for (const status of DEFAULT_STATUSES) {
          statusOrderKey = nextOrderKey(statusOrderKey);
          await tx
            .insert(schema.statuses)
            .values({ listId: inserted.id, ...status, orderKey: statusOrderKey });
        }

        return inserted;
      });

      await logActivity(space.workspaceId, ctx.user.id, "list", list.id, "list.created");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: list.id,
        workspaceId: space.workspaceId,
        kind: "created",
      });
      return list;
    }),

    update: protectedProcedure.input(updateListSchema).mutation(async ({ ctx, input }) => {
      const list = await requireList(input.listId);
      const space = await requireSpace(list.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:update", { spaceId: space.id });

      if (input.folderId) {
        const folder = await requireFolder(input.folderId);
        if (folder.spaceId !== list.spaceId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Folder does not belong to this space",
          });
        }
      }

      const [updated] = await db
        .update(schema.lists)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.lists.id, input.listId))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(space.workspaceId, ctx.user.id, "list", list.id, "list.updated");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: list.id,
        workspaceId: space.workspaceId,
        kind: "updated",
      });
      return updated;
    }),

    delete: protectedProcedure.input(deleteListSchema).mutation(async ({ ctx, input }) => {
      const list = await requireList(input.listId);
      const space = await requireSpace(list.spaceId);
      await assertCan(ctx.user, space.workspaceId, "hierarchy:delete", { spaceId: space.id });

      await db
        .update(schema.lists)
        .set({ deletedAt: new Date() })
        .where(eq(schema.lists.id, list.id));

      await logActivity(space.workspaceId, ctx.user.id, "list", list.id, "list.deleted");
      await publish(space.workspaceId, {
        entity: "hierarchy",
        id: list.id,
        workspaceId: space.workspaceId,
        kind: "deleted",
      });
      return { id: list.id };
    }),
  }),
});
