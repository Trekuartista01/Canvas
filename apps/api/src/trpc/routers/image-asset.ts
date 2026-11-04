import { db, schema } from "@canvas/db";
import {
  attachImageAssetToTaskSchema,
  createAnnotationSchema,
  deleteImageAssetSchema,
  editImageAssetSchema,
  generateImageAssetSchema,
  getImageAssetSchema,
  listAnnotationsSchema,
  listImageAssetsSchema,
  listImageLibrarySchema,
  moveImageAssetSchema,
  promoteImageVersionSchema,
} from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { logActivity } from "../../lib/activity";
import { AiQuotaError, assertAiQuota } from "../../lib/ai-quota";
import { referenceContextSuffix, resolveAiReferences } from "../../lib/ai-references";
import { resolveEffectiveBrandKit } from "../../lib/brand-kit";
import { publishImageAssetJob } from "../../lib/image-asset-realtime";
import { assertCan } from "../../lib/permissions";
import { requireTask, workspaceIdForTask, spaceIdForTask } from "../../lib/task-queries";
import { imageQueue } from "../../queues/image-queue";
import { protectedProcedure, router } from "../trpc";

export const imageAssetRouter = router({
  // Phase 6: the picker behind visual search — the workspace's recent
  // images with their current version's blurhash, for ImageVersionThumb.
  list: protectedProcedure.input(listImageAssetsSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "imageAsset:view");

    return db
      .select({
        id: schema.imageAssets.id,
        altText: schema.imageAssets.altText,
        currentVersionId: schema.imageAssets.currentVersionId,
        blurhash: schema.imageVersions.blurhash,
      })
      .from(schema.imageAssets)
      .leftJoin(
        schema.imageVersions,
        eq(schema.imageVersions.id, schema.imageAssets.currentVersionId),
      )
      .where(
        and(
          eq(schema.imageAssets.workspaceId, input.workspaceId),
          isNull(schema.imageAssets.deletedAt),
        ),
      )
      .orderBy(desc(schema.imageAssets.createdAt))
      .limit(60);
  }),

  // The Library page: every asset in the workspace (generated or uploaded),
  // keyset-paginated on id (UUIDv7 ids sort chronologically, so no separate
  // createdAt cursor is needed), newest first.
  library: protectedProcedure.input(listImageLibrarySchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "imageAsset:view");

    const conditions = [
      eq(schema.imageAssets.workspaceId, input.workspaceId),
      isNull(schema.imageAssets.deletedAt),
    ];
    if (input.origin !== "all") conditions.push(eq(schema.imageAssets.origin, input.origin));
    if (input.folderId) conditions.push(eq(schema.imageAssets.folderId, input.folderId));
    if (input.cursor) conditions.push(lt(schema.imageAssets.id, input.cursor));

    const q = input.search?.trim();
    if (q) {
      const pattern = `%${q}%`;
      const searchCondition = or(
        ilike(schema.imageAssets.altText, pattern),
        sql`${schema.imageAssets.tagsJson}::text ilike ${pattern}`,
      );
      if (searchCondition) conditions.push(searchCondition);
    }

    const rows = await db
      .select({
        id: schema.imageAssets.id,
        altText: schema.imageAssets.altText,
        tagsJson: schema.imageAssets.tagsJson,
        origin: schema.imageAssets.origin,
        createdAt: schema.imageAssets.createdAt,
        currentVersionId: schema.imageAssets.currentVersionId,
        folderId: schema.imageAssets.folderId,
        blurhash: schema.imageVersions.blurhash,
        width: schema.imageVersions.width,
        height: schema.imageVersions.height,
        prompt: schema.imageVersions.prompt,
      })
      .from(schema.imageAssets)
      .leftJoin(
        schema.imageVersions,
        eq(schema.imageVersions.id, schema.imageAssets.currentVersionId),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.imageAssets.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }),

  delete: protectedProcedure.input(deleteImageAssetSchema).mutation(async ({ ctx, input }) => {
    const asset = await db.query.imageAssets.findFirst({
      where: and(eq(schema.imageAssets.id, input.assetId), isNull(schema.imageAssets.deletedAt)),
    });
    if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCan(ctx.user, asset.workspaceId, "imageAsset:delete");

    await db
      .update(schema.imageAssets)
      .set({ deletedAt: new Date() })
      .where(eq(schema.imageAssets.id, asset.id));

    await logActivity(
      asset.workspaceId,
      ctx.user.id,
      "image_asset",
      asset.id,
      "image_asset.deleted",
    );

    return { id: asset.id };
  }),

  moveToFolder: protectedProcedure.input(moveImageAssetSchema).mutation(async ({ ctx, input }) => {
    const asset = await db.query.imageAssets.findFirst({
      where: and(eq(schema.imageAssets.id, input.assetId), isNull(schema.imageAssets.deletedAt)),
    });
    if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
    // Same tier as edit/promoteVersion above — modifying an asset you can
    // already see, not a separate permission of its own.
    await assertCan(ctx.user, asset.workspaceId, "imageAsset:create");

    if (input.folderId) {
      const folder = await db.query.imageFolders.findFirst({
        where: and(
          eq(schema.imageFolders.id, input.folderId),
          isNull(schema.imageFolders.deletedAt),
        ),
      });
      if (!folder || folder.workspaceId !== asset.workspaceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Folder not found" });
      }
    }

    const [updated] = await db
      .update(schema.imageAssets)
      .set({ folderId: input.folderId, updatedAt: new Date() })
      .where(eq(schema.imageAssets.id, asset.id))
      .returning();
    if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(
      asset.workspaceId,
      ctx.user.id,
      "image_asset",
      asset.id,
      "image_asset.moved",
      { folderId: input.folderId },
    );

    return updated;
  }),

  get: protectedProcedure.input(getImageAssetSchema).query(async ({ ctx, input }) => {
    const asset = await db.query.imageAssets.findFirst({
      where: and(eq(schema.imageAssets.id, input.assetId), isNull(schema.imageAssets.deletedAt)),
    });
    if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCan(ctx.user, asset.workspaceId, "imageAsset:view");

    const versions = await db.query.imageVersions.findMany({
      where: eq(schema.imageVersions.assetId, asset.id),
      orderBy: asc(schema.imageVersions.createdAt),
    });
    return { ...asset, versions };
  }),

  generate: protectedProcedure.input(generateImageAssetSchema).mutation(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "imageAsset:create");

    try {
      await assertAiQuota(ctx.user.id, "generate");
    } catch (err) {
      if (err instanceof AiQuotaError) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: err.message });
      }
      throw err;
    }

    if (input.folderId) {
      const folder = await db.query.imageFolders.findFirst({
        where: and(
          eq(schema.imageFolders.id, input.folderId),
          isNull(schema.imageFolders.deletedAt),
        ),
      });
      if (!folder || folder.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Folder not found" });
      }
    }

    let brandPalette: string[] | undefined;
    if (input.useBrandPalette) {
      const brand = await resolveEffectiveBrandKit({
        workspaceId: input.workspaceId,
        spaceId: input.spaceId,
        brandKitId: input.brandKitId,
      });
      if (brand?.paletteJson?.length) brandPalette = brand.paletteJson;
    }

    const refs = await resolveAiReferences(input.workspaceId, input.referenceAttachmentIds);
    const prompt = `${input.prompt}${referenceContextSuffix(refs)}`;
    const referenceImageUrls = refs
      .map((r) => r.imageUrl)
      .filter((url): url is string => typeof url === "string");

    const [asset] = await db
      .insert(schema.imageAssets)
      .values({
        workspaceId: input.workspaceId,
        createdBy: ctx.user.id,
        origin: "generation",
        folderId: input.folderId ?? null,
      })
      .returning();
    if (!asset) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    await logActivity(
      input.workspaceId,
      ctx.user.id,
      "image_asset",
      asset.id,
      "image_asset.generate_requested",
      {
        referenceAttachmentIds: input.referenceAttachmentIds,
      },
    );

    await imageQueue.add("generate", {
      kind: "generate",
      assetId: asset.id,
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      brandKitId: input.brandKitId,
      userId: ctx.user.id,
      prompt,
      size: input.size,
      style: input.style,
      brandPalette,
      n: input.n,
      referenceImageUrls,
    });

    await publishImageAssetJob(asset.id, {
      status: "queued",
      assetId: asset.id,
      kind: "generate",
    });

    return asset;
  }),

  edit: protectedProcedure.input(editImageAssetSchema).mutation(async ({ ctx, input }) => {
    const asset = await db.query.imageAssets.findFirst({
      where: and(eq(schema.imageAssets.id, input.assetId), isNull(schema.imageAssets.deletedAt)),
    });
    if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCan(ctx.user, asset.workspaceId, "imageAsset:create");

    try {
      await assertAiQuota(ctx.user.id, "generate");
    } catch (err) {
      if (err instanceof AiQuotaError) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: err.message });
      }
      throw err;
    }

    const parent = await db.query.imageVersions.findFirst({
      where: and(
        eq(schema.imageVersions.id, input.parentVersionId),
        eq(schema.imageVersions.assetId, asset.id),
      ),
    });
    if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Parent version not found" });

    await logActivity(
      asset.workspaceId,
      ctx.user.id,
      "image_asset",
      asset.id,
      "image_asset.edit_requested",
      { parentVersionId: parent.id },
    );

    await imageQueue.add("edit", {
      kind: "edit",
      assetId: asset.id,
      workspaceId: asset.workspaceId,
      userId: ctx.user.id,
      parentVersionId: parent.id,
      instruction: input.instruction,
      size: input.size,
    });

    await publishImageAssetJob(asset.id, {
      status: "queued",
      assetId: asset.id,
      kind: "edit",
    });

    return asset;
  }),

  promoteVersion: protectedProcedure
    .input(promoteImageVersionSchema)
    .mutation(async ({ ctx, input }) => {
      const asset = await db.query.imageAssets.findFirst({
        where: and(eq(schema.imageAssets.id, input.assetId), isNull(schema.imageAssets.deletedAt)),
      });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCan(ctx.user, asset.workspaceId, "imageAsset:create");

      const version = await db.query.imageVersions.findFirst({
        where: and(
          eq(schema.imageVersions.id, input.versionId),
          eq(schema.imageVersions.assetId, asset.id),
        ),
      });
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });

      const [updated] = await db
        .update(schema.imageAssets)
        .set({ currentVersionId: version.id, updatedAt: new Date() })
        .where(eq(schema.imageAssets.id, asset.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        asset.workspaceId,
        ctx.user.id,
        "image_asset",
        asset.id,
        "image_asset.version_promoted",
        { versionId: version.id },
      );

      return updated;
    }),

  attachToTask: protectedProcedure
    .input(attachImageAssetToTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const asset = await db.query.imageAssets.findFirst({
        where: and(eq(schema.imageAssets.id, input.assetId), isNull(schema.imageAssets.deletedAt)),
      });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCan(ctx.user, asset.workspaceId, "attachment:create", {
        spaceId: await spaceIdForTask(input.taskId),
      });

      const taskWorkspaceId = await workspaceIdForTask(input.taskId);
      if (taskWorkspaceId !== asset.workspaceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Task does not belong to this workspace",
        });
      }
      if (!asset.currentVersionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image has no current version yet" });
      }

      const version = await db.query.imageVersions.findFirst({
        where: eq(schema.imageVersions.id, asset.currentVersionId),
      });
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });

      const [attachment] = await db
        .insert(schema.attachments)
        .values({
          workspaceId: asset.workspaceId,
          taskId: input.taskId,
          uploaderId: ctx.user.id,
          imageAssetId: asset.id,
          fileKey: version.fileKey,
          fileName: `brain-${asset.id.slice(0, 8)}.png`,
          mime: "image/png",
          sizeBytes: 0,
          thumbKey: version.thumbKey,
          blurhash: version.blurhash,
          width: version.width,
          height: version.height,
        })
        .returning();
      if (!attachment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        asset.workspaceId,
        ctx.user.id,
        "attachment",
        attachment.id,
        "attachment.created",
        { taskId: input.taskId, imageAssetId: asset.id, source: "generation_ux" },
      );

      return attachment;
    }),

  annotation: router({
    list: protectedProcedure.input(listAnnotationsSchema).query(async ({ ctx, input }) => {
      const version = await db.query.imageVersions.findFirst({
        where: eq(schema.imageVersions.id, input.versionId),
      });
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });
      const asset = await db.query.imageAssets.findFirst({
        where: eq(schema.imageAssets.id, version.assetId),
      });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCan(ctx.user, asset.workspaceId, "imageAsset:view");

      const rows = await db
        .select({
          id: schema.annotations.id,
          x: schema.annotations.x,
          y: schema.annotations.y,
          w: schema.annotations.w,
          h: schema.annotations.h,
          createdAt: schema.annotations.createdAt,
          commentId: schema.comments.id,
          bodyJson: schema.comments.bodyJson,
          authorId: schema.comments.authorId,
          authorName: schema.users.name,
        })
        .from(schema.annotations)
        .innerJoin(schema.comments, eq(schema.comments.id, schema.annotations.commentId))
        .innerJoin(schema.users, eq(schema.users.id, schema.comments.authorId))
        .where(
          and(eq(schema.annotations.imageVersionId, version.id), isNull(schema.comments.deletedAt)),
        )
        .orderBy(asc(schema.annotations.createdAt));

      return rows.map((r) => ({
        id: r.id,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        createdAt: r.createdAt,
        comment: {
          id: r.commentId,
          bodyJson: r.bodyJson,
          authorId: r.authorId,
          authorName: r.authorName,
        },
      }));
    }),

    create: protectedProcedure.input(createAnnotationSchema).mutation(async ({ ctx, input }) => {
      const version = await db.query.imageVersions.findFirst({
        where: eq(schema.imageVersions.id, input.versionId),
      });
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });
      const asset = await db.query.imageAssets.findFirst({
        where: eq(schema.imageAssets.id, version.assetId),
      });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });

      const task = await requireTask(input.taskId);
      const taskWorkspaceId = await workspaceIdForTask(task.id);
      if (taskWorkspaceId !== asset.workspaceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Task does not belong to this workspace",
        });
      }
      // Same guest-level participation reasoning as comment:create — pinning
      // a comment to an image you can already see isn't a workspace mutation.
      await assertCan(ctx.user, asset.workspaceId, "comment:create", {
        spaceId: await spaceIdForTask(input.taskId),
      });

      const [comment] = await db
        .insert(schema.comments)
        .values({ taskId: task.id, authorId: ctx.user.id, bodyJson: input.bodyJson })
        .returning();
      if (!comment) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [annotation] = await db
        .insert(schema.annotations)
        .values({
          imageVersionId: version.id,
          commentId: comment.id,
          x: input.x,
          y: input.y,
        })
        .returning();
      if (!annotation) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await logActivity(
        asset.workspaceId,
        ctx.user.id,
        "annotation",
        annotation.id,
        "annotation.created",
        { taskId: task.id, imageVersionId: version.id },
      );

      return {
        id: annotation.id,
        x: annotation.x,
        y: annotation.y,
        w: annotation.w,
        h: annotation.h,
        createdAt: annotation.createdAt,
        comment: {
          id: comment.id,
          bodyJson: comment.bodyJson,
          authorId: comment.authorId,
          authorName: ctx.user.name,
        },
      };
    }),
  }),
});
