import { db, schema } from "@canvas/db";
import { globalSearchSchema, imagesLikeThisSchema, tasksByTextSchema } from "@canvas/shared";
import { TRPCError } from "@trpc/server";
import { and, cosineDistance, eq, isNull, ne } from "drizzle-orm";
import { getEmbeddingEngine } from "../../embedding-engine";
import { AiQuotaError, assertAiQuota } from "../../lib/ai-quota";
import { estimateEmbedCostUsd } from "../../lib/ai-usage";
import { writeAudit } from "../../lib/audit";
import { globalSearch } from "../../lib/global-search";
import { assertCan } from "../../lib/permissions";
import { protectedProcedure, router } from "../trpc";

export const searchRouter = router({
  // P8.8 (spec §9): people, tasks and, for HR alone, HR records. Plain database
  // queries: no embedding call, and the scoping lives in globalSearch.
  global: protectedProcedure.input(globalSearchSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "task:view");
    const results = await globalSearch(ctx.user, input.workspaceId, input.query);
    if ("hr" in results) {
      const { contracts, payroll, leave, vendims } = results.hr;
      if (contracts.length + payroll.length + leave.length + vendims.length > 0) {
        await writeAudit({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          action: "search.hr_results",
          entity: "search",
          ip: ctx.ip,
          payload: {
            query: input.query,
            contracts: contracts.length,
            payroll: payroll.length,
            leave: leave.length,
            vendims: vendims.length,
          },
        });
      }
    }
    return results;
  }),

  // Phase 6: semantic search over tasks. The query embedding is computed
  // inline here, not queued — a documented, narrow exception to CLAUDE.md's
  // "AI calls run in a worker" rule: this call exists only to answer the
  // very request the user is waiting on (no persisted artifact to protect
  // a worker retry for), and it's a single short-text encode, not a
  // multi-second generation. The persisted, potentially slow/costly side —
  // embedding a task's own content — still goes through embeddingWorker
  // exactly like every other AI call (see task.ts's enqueueTaskEmbedding).
  tasksByText: protectedProcedure.input(tasksByTextSchema).query(async ({ ctx, input }) => {
    await assertCan(ctx.user, input.workspaceId, "task:view");

    try {
      await assertAiQuota(ctx.user.id, "embed");
    } catch (err) {
      if (err instanceof AiQuotaError) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: err.message });
      }
      throw err;
    }

    const engine = getEmbeddingEngine();
    const queryVector = await engine.embed(input.query);
    await db.insert(schema.aiUsage).values({
      workspaceId: input.workspaceId,
      userId: ctx.user.id,
      kind: "embed",
      provider: engine.provider,
      model: engine.model,
      credits: 1,
      costUsdEst: estimateEmbedCostUsd(input.query.length),
    });

    const distance = cosineDistance(schema.embeddings.vector, queryVector);

    return db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        listId: schema.tasks.listId,
        listName: schema.lists.name,
        spaceName: schema.spaces.name,
        distance,
      })
      .from(schema.embeddings)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.embeddings.entityId))
      .innerJoin(schema.lists, eq(schema.lists.id, schema.tasks.listId))
      .innerJoin(schema.spaces, eq(schema.spaces.id, schema.lists.spaceId))
      .where(
        and(
          eq(schema.embeddings.entityType, "task"),
          eq(schema.embeddings.workspaceId, input.workspaceId),
          isNull(schema.tasks.deletedAt),
          isNull(schema.lists.deletedAt),
          isNull(schema.spaces.deletedAt),
        ),
      )
      .orderBy(distance)
      .limit(input.limit);
  }),

  // "Find images like this" (ARCHITECTURE.md's own phrase) — nearest
  // neighbors of an existing image asset's own stored embedding. No new
  // embed call at all: the source image was already embedded when its
  // alt-text/tags were generated (see image-understanding.ts).
  imagesLikeThis: protectedProcedure.input(imagesLikeThisSchema).query(async ({ ctx, input }) => {
    const asset = await db.query.imageAssets.findFirst({
      where: and(
        eq(schema.imageAssets.id, input.imageAssetId),
        isNull(schema.imageAssets.deletedAt),
      ),
    });
    if (!asset) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCan(ctx.user, asset.workspaceId, "imageAsset:view");

    const source = await db.query.embeddings.findFirst({
      where: and(
        eq(schema.embeddings.entityType, "image_asset"),
        eq(schema.embeddings.entityId, asset.id),
      ),
    });
    if (!source) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This image hasn't finished being analyzed yet",
      });
    }

    const distance = cosineDistance(schema.embeddings.vector, source.vector);

    return db
      .select({
        id: schema.imageAssets.id,
        altText: schema.imageAssets.altText,
        currentVersionId: schema.imageAssets.currentVersionId,
        blurhash: schema.imageVersions.blurhash,
        distance,
      })
      .from(schema.embeddings)
      .innerJoin(schema.imageAssets, eq(schema.imageAssets.id, schema.embeddings.entityId))
      .leftJoin(
        schema.imageVersions,
        eq(schema.imageVersions.id, schema.imageAssets.currentVersionId),
      )
      .where(
        and(
          eq(schema.embeddings.entityType, "image_asset"),
          eq(schema.embeddings.workspaceId, asset.workspaceId),
          isNull(schema.imageAssets.deletedAt),
          ne(schema.embeddings.entityId, asset.id),
        ),
      )
      .orderBy(distance)
      .limit(input.limit);
  }),
});
