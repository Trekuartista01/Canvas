import { canAccessBoard } from "../lib/permissions";
import { db, schema } from "@canvas/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { can, type WorkspaceAction } from "../auth/can";
import { logActivity } from "../lib/activity";
import { assertAiQuota } from "../lib/ai-quota";
import { publish as publishBrainEvent } from "../lib/brain-realtime";
import { critiqueImage } from "../lib/image-critique";
import { processImageJob } from "../lib/image-job-processor";
import { getMembershipRole } from "../lib/membership";
import { extractPlainText } from "../lib/plain-text";
import { workspaceIdForTask, spaceIdForTask } from "../lib/task-queries";
import {
  isToolName,
  parseToolInput,
  type AttachToTaskInput,
  type CritiqueImageInput,
  type EditImageInput,
  type GenerateImageInput,
  type SummarizeThreadInput,
  type ToolName,
} from "./tools";

export type ToolExecutionContext = {
  conversationId: string;
  workspaceId: string;
  userId: string;
  contextType: "task" | "doc" | "channel" | "global";
  contextId: string | null;
  toolUseId: string;
};

async function assertWorkerCan(userId: string, workspaceId: string, action: WorkspaceAction) {
  const role = await getMembershipRole(workspaceId, userId);
  // can() only reads user.id for identity; the rest are unused for workspace actions.
  if (
    !can({ id: userId, email: "", name: "", avatarUrl: null, bio: null, title: null }, action, {
      type: "workspace",
      role,
    })
  ) {
    throw new Error(`Forbidden: ${action}`);
  }
}

async function resolveTaskId(
  ctx: ToolExecutionContext,
  explicitTaskId: string | undefined,
): Promise<string> {
  let taskId = explicitTaskId ?? (ctx.contextType === "task" ? ctx.contextId : null);

  // Doc Brain: if exactly one task is linked, attach_to_task can omit task_id.
  if (!taskId && ctx.contextType === "doc" && ctx.contextId) {
    const links = await db
      .select({ taskId: schema.docTaskLinks.taskId })
      .from(schema.docTaskLinks)
      .where(eq(schema.docTaskLinks.docId, ctx.contextId));
    if (links.length === 1) taskId = links[0]!.taskId;
    else if (links.length > 1) {
      throw new Error("Multiple linked tasks — pass task_id explicitly");
    }
  }

  if (!taskId) {
    throw new Error("task_id is required when not chatting in a task context");
  }
  const taskWorkspaceId = await workspaceIdForTask(taskId);
  if (taskWorkspaceId !== ctx.workspaceId) {
    throw new Error("Task does not belong to this workspace");
  }
  // P8.9: tools act as the person chatting, so they can't reach a board that
  // person can't. can() only reads user.id here, as in assertWorkerCan.
  const user = { id: ctx.userId, email: "", name: "", avatarUrl: null, bio: null, title: null };
  if (!(await canAccessBoard(user, ctx.workspaceId, await spaceIdForTask(taskId)))) {
    throw new Error("Forbidden: this person isn't on that board");
  }
  return taskId;
}

async function executeGenerateImage(ctx: ToolExecutionContext, input: GenerateImageInput) {
  await assertWorkerCan(ctx.userId, ctx.workspaceId, "imageAsset:create");
  // Same gate the direct Generate panel's imageAsset.generate mutation
  // uses (image-asset.ts) — without this, Brain's tool call bypassed the
  // daily image-generation quota entirely (found 2026-07-29, see
  // PROGRESS.md).
  await assertAiQuota(ctx.userId, "generate");

  const [asset] = await db
    .insert(schema.imageAssets)
    .values({
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      origin: "generation",
    })
    .returning();
  if (!asset) throw new Error("Failed to create image asset");

  await logActivity(
    ctx.workspaceId,
    ctx.userId,
    "image_asset",
    asset.id,
    "image_asset.generate_requested",
  );

  await publishBrainEvent(ctx.conversationId, {
    type: "image_status",
    status: "queued",
    assetId: asset.id,
    toolUseId: ctx.toolUseId,
  });
  await publishBrainEvent(ctx.conversationId, {
    type: "image_status",
    status: "generating",
    assetId: asset.id,
    toolUseId: ctx.toolUseId,
  });

  const result = await processImageJob({
    kind: "generate",
    assetId: asset.id,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    prompt: input.prompt,
    size: input.size,
  });

  await publishBrainEvent(ctx.conversationId, {
    type: "image_status",
    status: "done",
    assetId: asset.id,
    versionId: result.currentVersionId,
    toolUseId: ctx.toolUseId,
  });

  return {
    assetId: asset.id,
    versionId: result.currentVersionId,
    versionIds: result.versionIds,
    prompt: input.prompt,
    size: input.size,
  };
}

async function executeEditImage(ctx: ToolExecutionContext, input: EditImageInput) {
  await assertWorkerCan(ctx.userId, ctx.workspaceId, "imageAsset:create");
  // Same gate the direct Generate panel's imageAsset.edit mutation uses —
  // see executeGenerateImage's comment above.
  await assertAiQuota(ctx.userId, "generate");

  const parent = await db.query.imageVersions.findFirst({
    where: eq(schema.imageVersions.id, input.image_version_id),
  });
  if (!parent) throw new Error(`image version ${input.image_version_id} not found`);

  const asset = await db.query.imageAssets.findFirst({
    where: eq(schema.imageAssets.id, parent.assetId),
  });
  if (!asset || asset.workspaceId !== ctx.workspaceId) {
    throw new Error("Image version does not belong to this workspace");
  }

  await publishBrainEvent(ctx.conversationId, {
    type: "image_status",
    status: "queued",
    assetId: asset.id,
    toolUseId: ctx.toolUseId,
  });
  await publishBrainEvent(ctx.conversationId, {
    type: "image_status",
    status: "generating",
    assetId: asset.id,
    toolUseId: ctx.toolUseId,
  });

  const result = await processImageJob({
    kind: "edit",
    assetId: asset.id,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    parentVersionId: parent.id,
    instruction: input.instruction,
    size: input.size,
  });

  await publishBrainEvent(ctx.conversationId, {
    type: "image_status",
    status: "done",
    assetId: asset.id,
    versionId: result.currentVersionId,
    toolUseId: ctx.toolUseId,
  });

  return {
    assetId: asset.id,
    versionId: result.currentVersionId,
    versionIds: result.versionIds,
    parentVersionId: parent.id,
    instruction: input.instruction,
  };
}

async function executeAttachToTask(ctx: ToolExecutionContext, input: AttachToTaskInput) {
  await assertWorkerCan(ctx.userId, ctx.workspaceId, "attachment:create");

  const taskId = await resolveTaskId(ctx, input.task_id);
  const asset = await db.query.imageAssets.findFirst({
    where: eq(schema.imageAssets.id, input.image_asset_id),
  });
  if (!asset || asset.workspaceId !== ctx.workspaceId) {
    throw new Error("Image asset does not belong to this workspace");
  }
  if (!asset.currentVersionId) {
    throw new Error("Image asset has no current version yet");
  }

  const version = await db.query.imageVersions.findFirst({
    where: eq(schema.imageVersions.id, asset.currentVersionId),
  });
  if (!version) throw new Error("Current image version not found");

  // Reuse the Brain object's S3 keys rather than copying bytes — the
  // attachment row points at the same objects. See PROGRESS.md (M2.3).
  const [attachment] = await db
    .insert(schema.attachments)
    .values({
      workspaceId: ctx.workspaceId,
      taskId,
      uploaderId: ctx.userId,
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
  if (!attachment) throw new Error("Failed to create attachment");

  await logActivity(
    ctx.workspaceId,
    ctx.userId,
    "attachment",
    attachment.id,
    "attachment.created",
    {
      taskId,
      imageAssetId: asset.id,
      source: "brain",
    },
  );

  return {
    attachmentId: attachment.id,
    taskId,
    assetId: asset.id,
    versionId: version.id,
  };
}

async function executeCritiqueImage(ctx: ToolExecutionContext, input: CritiqueImageInput) {
  await assertWorkerCan(ctx.userId, ctx.workspaceId, "imageAsset:view");
  // Same quota gate executeGenerateImage/executeEditImage apply — critique
  // still writes a costed ai_usage row, so it must not be a free,
  // unlimited-spend path through the Brain tool loop. Shares Brain's
  // Claude-call quota tier, same reasoning copywriter.ts's
  // assertAiQuotaOrThrow uses.
  await assertAiQuota(ctx.userId, "brain");

  const version = await db.query.imageVersions.findFirst({
    where: eq(schema.imageVersions.id, input.image_version_id),
  });
  if (!version) throw new Error(`image version ${input.image_version_id} not found`);

  const asset = await db.query.imageAssets.findFirst({
    where: eq(schema.imageAssets.id, version.assetId),
  });
  if (!asset || asset.workspaceId !== ctx.workspaceId) {
    throw new Error("Image version does not belong to this workspace");
  }

  const critique = await critiqueImage({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    versionId: version.id,
    prompt: version.prompt,
    instruction: version.instruction,
  });

  return { versionId: version.id, critique };
}

async function executeSummarizeThread(ctx: ToolExecutionContext, input: SummarizeThreadInput) {
  await assertWorkerCan(ctx.userId, ctx.workspaceId, "comment:view");

  const taskId = await resolveTaskId(ctx, input.task_id);
  const comments = await db.query.comments.findMany({
    where: and(eq(schema.comments.taskId, taskId), isNull(schema.comments.deletedAt)),
    orderBy: asc(schema.comments.createdAt),
  });

  if (comments.length === 0) {
    return { taskId, commentCount: 0, transcript: "No comments on this task yet." };
  }

  const authorIds = [...new Set(comments.map((c) => c.authorId))];
  const authors =
    authorIds.length === 0
      ? []
      : await db.select().from(schema.users).where(inArray(schema.users.id, authorIds));
  const nameById = new Map(authors.map((u) => [u.id, u.name]));

  const lines = comments.map((c) => {
    const author = nameById.get(c.authorId) ?? "Unknown";
    const body = extractPlainText(c.bodyJson).trim() || "(empty)";
    return `${author}: ${body}`;
  });

  return {
    taskId,
    commentCount: comments.length,
    transcript: lines.join("\n"),
  };
}

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolExecutionContext,
): Promise<{ name: ToolName; result: unknown; imageVersionIds?: string[] }> {
  if (!isToolName(name)) {
    return { name: name as ToolName, result: { error: `Unknown tool: ${name}` } };
  }

  await publishBrainEvent(ctx.conversationId, {
    type: "tool_status",
    name,
    status: "running",
    toolUseId: ctx.toolUseId,
  });

  try {
    const input = parseToolInput(name, rawInput);
    let result: unknown;
    let imageVersionIds: string[] | undefined;

    switch (name) {
      case "generate_image": {
        const r = await executeGenerateImage(ctx, input as GenerateImageInput);
        result = r;
        imageVersionIds = r.versionIds;
        break;
      }
      case "edit_image": {
        const r = await executeEditImage(ctx, input as EditImageInput);
        result = r;
        imageVersionIds = r.versionIds;
        break;
      }
      case "attach_to_task":
        result = await executeAttachToTask(ctx, input as AttachToTaskInput);
        break;
      case "summarize_thread":
        result = await executeSummarizeThread(ctx, input as SummarizeThreadInput);
        break;
      case "critique_image":
        result = await executeCritiqueImage(ctx, input as CritiqueImageInput);
        break;
    }

    await publishBrainEvent(ctx.conversationId, {
      type: "tool_status",
      name,
      status: "done",
      toolUseId: ctx.toolUseId,
    });

    return { name, result, imageVersionIds };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool failed";
    await publishBrainEvent(ctx.conversationId, {
      type: "tool_status",
      name,
      status: "error",
      toolUseId: ctx.toolUseId,
      detail: message,
    });
    if (name === "generate_image" || name === "edit_image") {
      // Best-effort image_status error if we already had an asset id in the input path
    }
    return { name, result: { error: message } };
  }
}
