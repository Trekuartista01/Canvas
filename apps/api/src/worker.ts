import { db, schema } from "@canvas/db";
import { Worker } from "bullmq";
import { asc, and, eq, isNull } from "drizzle-orm";
import { getChatClient, type ProviderMessage, type ToolCall } from "./brain";
import { executeTool } from "./brain/execute-tool";
import { BRAIN_TOOLS } from "./brain/tools";
import { getCopyClient, type CopyImage, type CopyVariant } from "./copywriter";
import { estimateChatCostUsd } from "./lib/ai-usage";
import { logActivity } from "./lib/activity";
import { resolveEffectiveBrandKit } from "./lib/brand-kit";
import { buildSystemPrompt, type BrandContext } from "./lib/brain-system-prompt";
import { publish as publishBrainEvent } from "./lib/brain-realtime";
import { fetchApprovedExamples } from "./lib/copywriter";
import { publishCopyGenerationJob } from "./lib/copy-generation-realtime";
import { runEmbedding } from "./lib/embedding-runner";
import { publishImageAssetJob } from "./lib/image-asset-realtime";
import { processImageJob } from "./lib/image-job-processor";
import { runSchedulerTick } from "./lib/scheduler";
import { captureException, initSentry } from "./lib/sentry";
import { ensureBucketExists, getObject } from "./lib/storage";
import { safeFetch } from "./lib/safe-outbound-url";
import { BRAIN_QUEUE_NAME, type BrainJobData } from "./queues/brain-queue";
import { redisConnection } from "./queues/connection";
import { COPYWRITER_QUEUE_NAME, type CopywriterJobData } from "./queues/copywriter-queue";
import { EMBEDDING_QUEUE_NAME, type EmbeddingJobData } from "./queues/embedding-queue";
import { IMAGE_QUEUE_NAME, type ImageJobData } from "./queues/image-queue";
import { scheduleRecurringTick, SCHEDULER_QUEUE_NAME } from "./queues/scheduler-queue";
import { SLACK_QUEUE_NAME, type SlackJobData } from "./queues/slack-queue";

initSentry("worker");

// A separate process from the API server (`pnpm --filter @canvas/api
// worker`, wired into the root `pnpm dev` alongside it) — matches
// ARCHITECTURE.md's diagram, which draws "BullMQ workers" as its own box
// distinct from the Fastify API, and CLAUDE.md's hard rule that external AI
// calls "run in BullMQ workers — never in request handlers." Both queues
// (image-jobs, brain-jobs) are consumed by this one process for now.
await ensureBucketExists();

const MAX_AGENT_ROUNDS = 5;

const imageWorker = new Worker<ImageJobData>(
  IMAGE_QUEUE_NAME,
  async (job) => {
    const { assetId, kind } = job.data;
    await publishImageAssetJob(assetId, { status: "generating", assetId, kind });
    try {
      const result = await processImageJob(job.data);
      await publishImageAssetJob(assetId, {
        status: "done",
        assetId,
        kind,
        versionId: result.currentVersionId,
      });
    } catch (err) {
      await publishImageAssetJob(assetId, {
        status: "error",
        assetId,
        kind,
        message: err instanceof Error ? err.message : "Image job failed",
      });
      throw err;
    }
  },
  { connection: redisConnection },
);

imageWorker.on("failed", (job, err) => {
  captureException(err);
  console.error(`[worker] image job ${job?.id} failed:`, err);
});

function messageText(contentJson: unknown): string {
  if (
    contentJson &&
    typeof contentJson === "object" &&
    "text" in contentJson &&
    typeof (contentJson as { text: unknown }).text === "string"
  ) {
    return (contentJson as { text: string }).text;
  }
  return "";
}

function mediaTypeForKey(
  fileKey: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  const lower = fileKey.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  // Unrecognized extension — the caller skips it (`if (!mediaType) continue`)
  // rather than mislabeling it, since sending the wrong media type to the
  // vision API is worse than just omitting that one attachment.
  return null;
}

function toolCallsFromContent(contentJson: unknown): ToolCall[] | undefined {
  if (!contentJson || typeof contentJson !== "object") return undefined;
  const calls = (contentJson as { toolCalls?: unknown }).toolCalls;
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  return calls as ToolCall[];
}

type HistoryImage = NonNullable<Extract<ProviderMessage, { role: "user" }>["images"]>[number];

async function loadHistoryImage(versionId: string): Promise<HistoryImage | null> {
  const version = await db.query.imageVersions.findFirst({
    where: eq(schema.imageVersions.id, versionId),
  });
  if (!version) return null;
  const obj = await getObject(version.fileKey);
  const bytes = await obj.Body?.transformToByteArray();
  if (!bytes) return null;
  const mediaType = mediaTypeForKey(version.fileKey);
  if (!mediaType) return null;
  return { mediaType, data: Buffer.from(bytes).toString("base64") };
}

async function historyMessageToProviderMessage(
  m: typeof schema.brainMessages.$inferSelect,
): Promise<ProviderMessage | null> {
  if (m.role === "user") {
    const loaded = await Promise.all((m.imageVersionIds ?? []).map(loadHistoryImage));
    const images = loaded.filter((img): img is HistoryImage => img !== null);
    return {
      role: "user",
      text: messageText(m.contentJson),
      ...(images.length > 0 ? { images } : {}),
    };
  }
  if (m.role === "assistant") {
    const text = messageText(m.contentJson);
    const toolCalls = toolCallsFromContent(m.contentJson);
    return {
      role: "assistant",
      ...(text ? { text } : {}),
      ...(toolCalls ? { toolCalls } : {}),
    };
  }
  if (m.role === "tool") {
    const c = m.contentJson as {
      toolUseId?: string;
      name?: string;
      result?: unknown;
    } | null;
    if (c?.toolUseId && c.name) {
      return { role: "tool", toolUseId: c.toolUseId, name: c.name, result: c.result ?? {} };
    }
  }
  return null;
}

// Per-message provider-message construction runs in parallel (Promise.all
// preserves input order regardless of completion order) — a user message
// with several attached reference images used to resolve each one's DB
// lookup + S3 GET sequentially, one full network round trip after another.
async function historyToProviderMessages(
  history: (typeof schema.brainMessages.$inferSelect)[],
): Promise<ProviderMessage[]> {
  const messages = await Promise.all(history.map(historyMessageToProviderMessage));
  return messages.filter((m): m is ProviderMessage => m !== null);
}

async function buildTaskSystemPrompt(taskId: string, brand: BrandContext | null): Promise<string> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) return buildSystemPrompt({ type: "global" }, brand);
  const list = await db.query.lists.findFirst({ where: eq(schema.lists.id, task.listId) });
  return buildSystemPrompt(
    {
      type: "task",
      title: task.title,
      listName: list?.name ?? "unknown list",
      descriptionJson: task.descriptionJson,
    },
    brand,
  );
}

async function buildDocSystemPrompt(docId: string, brand: BrandContext | null): Promise<string> {
  const doc = await db.query.docs.findFirst({
    where: and(eq(schema.docs.id, docId), isNull(schema.docs.deletedAt)),
  });
  if (!doc) return buildSystemPrompt({ type: "global" }, brand);

  const linkedTasks = await db
    .select({ id: schema.tasks.id, title: schema.tasks.title })
    .from(schema.docTaskLinks)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.docTaskLinks.taskId))
    .where(and(eq(schema.docTaskLinks.docId, docId), isNull(schema.tasks.deletedAt)));

  return buildSystemPrompt(
    {
      type: "doc",
      title: doc.title,
      linkedTasks,
    },
    brand,
  );
}

const brainWorker = new Worker<BrainJobData>(
  BRAIN_QUEUE_NAME,
  async (job) => {
    const data = job.data;

    const conversation = await db.query.brainConversations.findFirst({
      where: eq(schema.brainConversations.id, data.conversationId),
    });
    if (!conversation) throw new Error(`brain_conversations row ${data.conversationId} not found`);

    const brandKit = conversation.brandKitId
      ? await resolveEffectiveBrandKit({
          workspaceId: conversation.workspaceId,
          brandKitId: conversation.brandKitId,
        })
      : null;
    const brand: BrandContext | null = brandKit
      ? {
          name: brandKit.name,
          palette: brandKit.paletteJson ?? [],
          tone: brandKit.tone,
          guidelines: brandKit.guidelines,
        }
      : null;

    const systemPrompt =
      conversation.contextType === "task" && conversation.contextId
        ? await buildTaskSystemPrompt(conversation.contextId, brand)
        : conversation.contextType === "doc" && conversation.contextId
          ? await buildDocSystemPrompt(conversation.contextId, brand)
          : buildSystemPrompt({ type: "global" }, brand);

    const chatClient = getChatClient();
    let lastAssistantMessageId: string | null = null;
    let totalInputChars = systemPrompt.length;
    let totalOutputChars = 0;

    try {
      for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
        const history = await db.query.brainMessages.findMany({
          where: eq(schema.brainMessages.conversationId, data.conversationId),
          orderBy: asc(schema.brainMessages.createdAt),
        });
        const providerMessages = await historyToProviderMessages(history);
        totalInputChars += providerMessages.reduce((sum, m) => {
          if (m.role === "user") return sum + m.text.length;
          if (m.role === "assistant") return sum + (m.text?.length ?? 0);
          return sum + JSON.stringify(m.result).length;
        }, 0);

        let fullText = "";
        const toolCalls: ToolCall[] = [];
        let stopReason: "end_turn" | "tool_use" | "max_tokens" | "other" = "end_turn";

        for await (const chunk of chatClient.streamChat({
          messages: providerMessages,
          systemPrompt,
          tools: BRAIN_TOOLS,
        })) {
          if (chunk.type === "text") {
            fullText += chunk.text;
            await publishBrainEvent(data.conversationId, { type: "delta", text: chunk.text });
          } else if (chunk.type === "tool_use") {
            toolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
          } else if (chunk.type === "message_stop") {
            stopReason = chunk.stopReason;
          }
        }

        totalOutputChars += fullText.length;

        const [assistantMessage] = await db
          .insert(schema.brainMessages)
          .values({
            conversationId: data.conversationId,
            role: "assistant",
            contentJson: {
              ...(fullText ? { text: fullText } : {}),
              ...(toolCalls.length > 0 ? { toolCalls } : {}),
            },
            imageVersionIds: null,
          })
          .returning();
        if (!assistantMessage) throw new Error("Failed to save assistant message");
        lastAssistantMessageId = assistantMessage.id;

        if (stopReason !== "tool_use" || toolCalls.length === 0) {
          break;
        }

        const versionIds: string[] = [];
        for (const call of toolCalls) {
          const executed = await executeTool(call.name, call.input, {
            conversationId: data.conversationId,
            workspaceId: data.workspaceId,
            userId: data.userId,
            contextType: conversation.contextType,
            contextId: conversation.contextId,
            toolUseId: call.id,
          });

          if (executed.imageVersionIds?.length) {
            versionIds.push(...executed.imageVersionIds);
          }

          await db.insert(schema.brainMessages).values({
            conversationId: data.conversationId,
            role: "tool",
            contentJson: {
              toolUseId: call.id,
              name: executed.name,
              result: executed.result,
            },
            imageVersionIds: executed.imageVersionIds ?? null,
          });
        }

        if (versionIds.length > 0) {
          await db
            .update(schema.brainMessages)
            .set({ imageVersionIds: versionIds })
            .where(eq(schema.brainMessages.id, assistantMessage.id));
        }
      }
    } catch (err) {
      console.error(`[worker] brain job for conversation ${data.conversationId} failed:`, err);
      await publishBrainEvent(data.conversationId, {
        type: "error",
        message: "Something went wrong generating a response.",
      });
      throw err;
    }

    if (!lastAssistantMessageId) {
      throw new Error("Brain agent loop produced no assistant message");
    }

    await db.insert(schema.aiUsage).values({
      workspaceId: data.workspaceId,
      userId: data.userId,
      kind: "chat",
      provider: chatClient.provider,
      model: chatClient.model,
      credits: 1,
      costUsdEst: estimateChatCostUsd(chatClient.provider, totalInputChars, totalOutputChars),
    });

    await publishBrainEvent(data.conversationId, {
      type: "done",
      messageId: lastAssistantMessageId,
    });
  },
  { connection: redisConnection },
);

brainWorker.on("failed", (job, err) => {
  captureException(err);
  console.error(`[worker] brain job ${job?.id} failed:`, err);
});

// M3.5: recurring tasks + reminders. A single repeatable "tick" job rather
// than a dedicated always-on scheduler process — same BullMQ + Redis
// infra ARCHITECTURE.md already calls for, no new moving part.
await scheduleRecurringTick();

const schedulerWorker = new Worker(
  SCHEDULER_QUEUE_NAME,
  async () => {
    await runSchedulerTick();
  },
  { connection: redisConnection },
);

schedulerWorker.on("failed", (job, err) => {
  captureException(err);
  console.error(`[worker] scheduler tick ${job?.id} failed:`, err);
});

// M5.6 integrations: Slack notify. A Slack Incoming Webhook expects a bare
// `{text}` JSON body, delivered off the request path so a slow Slack
// endpoint never blocks the triggering request.
const SLACK_DELIVERY_TIMEOUT_MS = 10_000;

const slackWorker = new Worker<SlackJobData>(
  SLACK_QUEUE_NAME,
  async (job) => {
    const { webhookUrl, text } = job.data;
    const response = await safeFetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SLACK_DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Slack delivery to ${webhookUrl} failed with status ${response.status}`);
    }
  },
  { connection: redisConnection },
);

slackWorker.on("failed", (job, err) => {
  captureException(err);
  console.error(`[worker] slack delivery ${job?.id} failed:`, err);
});

// Phase 6: semantic + visual search. Content embeddings (task text, image
// alt-text/tags) are the persisted, potentially-slow/costly AI call CLAUDE.md's
// "run in a worker" rule is about — see search.ts for why the ephemeral
// per-request *query* embedding is the one documented exception.
const embeddingWorker = new Worker<EmbeddingJobData>(
  EMBEDDING_QUEUE_NAME,
  async (job) => {
    await runEmbedding(job.data);
  },
  { connection: redisConnection },
);

embeddingWorker.on("failed", (job, err) => {
  captureException(err);
  console.error(`[worker] embedding ${job?.data.entityType}/${job?.data.entityId} failed:`, err);
});

// Resolves each frame attachment's stored bytes into vision-ready base64 —
// same shape as historyToProviderMessages' loadHistoryImage above, reused
// here for the Copywriter's design/video-frame attachments instead of Brain
// history images.
async function loadFrameImage(attachmentId: string): Promise<CopyImage | null> {
  const attachment = await db.query.attachments.findFirst({
    where: eq(schema.attachments.id, attachmentId),
  });
  if (!attachment?.fileKey) return null;
  const mediaType = mediaTypeForKey(attachment.fileKey);
  if (!mediaType) return null;
  const obj = await getObject(attachment.fileKey);
  const bytes = await obj.Body?.transformToByteArray();
  if (!bytes) return null;
  return { mediaType, data: Buffer.from(bytes).toString("base64") };
}

const copywriterWorker = new Worker<CopywriterJobData>(
  COPYWRITER_QUEUE_NAME,
  async (job) => {
    const data = job.data;
    await publishCopyGenerationJob(data.generationId, {
      status: "generating",
      generationId: data.generationId,
    });

    try {
      const brandKit = await db.query.brandSettings.findFirst({
        where: eq(schema.brandSettings.id, data.brandKitId),
      });
      if (!brandKit) throw new Error(`brand_settings row ${data.brandKitId} not found`);

      const brand = {
        name: brandKit.name,
        voice: brandKit.tone,
        colors: brandKit.paletteJson.length ? brandKit.paletteJson.join(", ") : null,
        fonts: brandKit.fonts,
        notes: brandKit.guidelines,
      };

      const approvedExamples = await fetchApprovedExamples(data.brandKitId);
      const copyClient = getCopyClient();

      const images = (await Promise.all(data.frameAttachmentIds.map(loadFrameImage))).filter(
        (img): img is CopyImage => img !== null,
      );
      if (images.length === 0) throw new Error("No usable frame images for this generation");

      if (data.kind === "generate") {
        const result = await copyClient.generateCopy({
          brand,
          approvedExamples,
          copyType: data.copyType,
          length: data.length,
          language: data.language,
          images,
          isVideoFrames: images.length > 1,
          extra: data.extra,
        });

        await db
          .update(schema.copyGenerations)
          .set({
            designRead: result.designRead,
            variantsJson: result.variants,
            status: "completed",
            updatedAt: new Date(),
          })
          .where(eq(schema.copyGenerations.id, data.generationId));

        await db.insert(schema.aiUsage).values({
          workspaceId: data.workspaceId,
          userId: data.userId,
          kind: "chat",
          provider: copyClient.provider,
          model: copyClient.model,
          credits: 1,
          costUsdEst: estimateChatCostUsd(
            copyClient.provider,
            result.inputChars,
            result.outputChars,
          ),
        });

        await logActivity(
          data.workspaceId,
          data.userId,
          "copy_generation",
          data.generationId,
          "copy_generation.generated",
        );
      } else {
        const existing = await db.query.copyGenerations.findFirst({
          where: eq(schema.copyGenerations.id, data.generationId),
        });
        if (!existing) throw new Error(`copy_generations row ${data.generationId} not found`);
        const variants = existing.variantsJson ?? [];
        const target = variants[data.variantIndex];
        if (!target) throw new Error("Variant index out of range");

        const result = await copyClient.refineCopy({
          brand,
          approvedExamples,
          copyType: existing.copyType,
          length: existing.length,
          language: existing.language,
          images,
          variant: target,
          instruction: data.instruction,
        });

        const nextVariants: CopyVariant[] = variants.map((v, i) =>
          i === data.variantIndex ? result.variant : v,
        );
        await db
          .update(schema.copyGenerations)
          .set({ variantsJson: nextVariants, updatedAt: new Date() })
          .where(eq(schema.copyGenerations.id, data.generationId));

        await db.insert(schema.aiUsage).values({
          workspaceId: data.workspaceId,
          userId: data.userId,
          kind: "chat",
          provider: copyClient.provider,
          model: copyClient.model,
          credits: 1,
          costUsdEst: estimateChatCostUsd(
            copyClient.provider,
            result.inputChars,
            result.outputChars,
          ),
        });

        await logActivity(
          data.workspaceId,
          data.userId,
          "copy_generation",
          data.generationId,
          "copy_generation.refined",
        );
      }

      await publishCopyGenerationJob(data.generationId, {
        status: "done",
        generationId: data.generationId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Copy generation failed";
      // A failed *refine* leaves the row's already-completed variants alone
      // — only a failed initial *generate* (which has no variants yet)
      // should flip the row itself to 'failed'.
      if (data.kind === "generate") {
        await db
          .update(schema.copyGenerations)
          .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
          .where(eq(schema.copyGenerations.id, data.generationId));
      }
      await publishCopyGenerationJob(data.generationId, {
        status: "error",
        generationId: data.generationId,
        message,
      });
      throw err;
    }
  },
  { connection: redisConnection },
);

copywriterWorker.on("failed", (job, err) => {
  captureException(err);
  console.error(`[worker] copywriter job ${job?.id} failed:`, err);
});

console.log(
  `[worker] listening on queues "${IMAGE_QUEUE_NAME}", "${BRAIN_QUEUE_NAME}", "${SCHEDULER_QUEUE_NAME}", "${SLACK_QUEUE_NAME}", "${EMBEDDING_QUEUE_NAME}", "${COPYWRITER_QUEUE_NAME}"`,
);
