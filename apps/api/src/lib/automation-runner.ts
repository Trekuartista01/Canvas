import { db, schema } from "@canvas/db";
import {
  automationActionSchema,
  automationConditionSchema,
  automationTriggerSchema,
  type AutomationAction,
  type TaskPriority,
} from "@canvas/shared";
import { eq } from "drizzle-orm";
import { can } from "../auth/can";
import { imageQueue } from "../queues/image-queue";
import { slackQueue } from "../queues/slack-queue";
import { logActivity } from "./activity";
import { assertAiQuota } from "./ai-quota";
import {
  evaluateConditions,
  interpolatePrompt,
  triggerMatches,
  type AutomationTriggerEvent,
} from "./automation-engine";
import { publishImageAssetJob } from "./image-asset-realtime";
import { getMembershipRole } from "./membership";
import { buildTaskUpdateFields } from "./task-update";

interface TriggeringTask {
  id: string;
  listId: string;
  title: string;
  priority: TaskPriority | null;
}

type ActionLogEntry = {
  action: AutomationAction["type"];
  ok: boolean;
  detail?: unknown;
  error?: string;
};

async function executeAction(
  action: AutomationAction,
  ctx: { workspaceId: string; actorId: string; task: TriggeringTask },
): Promise<unknown> {
  switch (action.type) {
    case "set_priority": {
      await db
        .update(schema.tasks)
        .set({ ...buildTaskUpdateFields({ priority: action.priority }), updatedAt: new Date() })
        .where(eq(schema.tasks.id, ctx.task.id));
      await logActivity(
        ctx.workspaceId,
        ctx.actorId,
        "task",
        ctx.task.id,
        "task.updated_by_automation",
        { priority: action.priority },
      );
      return { priority: action.priority };
    }

    case "add_tag": {
      const tag = await db.query.tags.findFirst({ where: eq(schema.tags.id, action.tagId) });
      if (!tag || tag.workspaceId !== ctx.workspaceId) {
        throw new Error("Tag does not belong to this workspace");
      }
      await db
        .insert(schema.taskTags)
        .values({ taskId: ctx.task.id, tagId: tag.id })
        .onConflictDoNothing();
      await logActivity(ctx.workspaceId, ctx.actorId, "task", ctx.task.id, "task.tagged", {
        tagId: tag.id,
      });
      return { tagId: tag.id, tagName: tag.name };
    }

    case "post_comment": {
      const [comment] = await db
        .insert(schema.comments)
        .values({
          taskId: ctx.task.id,
          authorId: ctx.actorId,
          bodyJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: action.text }] }],
          },
        })
        .returning();
      if (!comment) throw new Error("Failed to create comment");
      return { commentId: comment.id };
    }

    case "generate_image": {
      // Automations run unattended (no live session), and their creator's
      // role can be downgraded/removed after the automation was set up —
      // re-check imageAsset:create against their *current* role every run,
      // same as Brain's tool loop (execute-tool.ts's assertWorkerCan) does
      // for the identical action.
      const role = await getMembershipRole(ctx.workspaceId, ctx.actorId);
      if (
        !can(
          { id: ctx.actorId, email: "", name: "", avatarUrl: null, bio: null, title: null },
          "imageAsset:create",
          { type: "workspace", role },
        )
      ) {
        throw new Error("Forbidden: imageAsset:create");
      }
      await assertAiQuota(ctx.actorId, "generate");

      const [asset] = await db
        .insert(schema.imageAssets)
        .values({ workspaceId: ctx.workspaceId, createdBy: ctx.actorId, origin: "generation" })
        .returning();
      if (!asset) throw new Error("Failed to create image asset");

      const prompt = interpolatePrompt(action.prompt, { title: ctx.task.title });
      await logActivity(
        ctx.workspaceId,
        ctx.actorId,
        "image_asset",
        asset.id,
        "image_asset.generate_requested",
        { fromAutomation: true },
      );
      await imageQueue.add("generate", {
        kind: "generate",
        assetId: asset.id,
        workspaceId: ctx.workspaceId,
        userId: ctx.actorId,
        prompt,
        size: "square",
        n: 1,
      });
      await publishImageAssetJob(asset.id, {
        status: "queued",
        assetId: asset.id,
        kind: "generate",
      });
      return { assetId: asset.id, prompt };
    }

    case "slack_notify": {
      // Never fetch() inline here — same "never block the request handler
      // on an external call" rule (this
      // action runs synchronously inside task.create/update's request
      // handler via runAutomationsForTrigger). The queued job is
      // fire-and-forget from this action's point of view: a failed Slack
      // delivery doesn't mark the automation run itself as an error, same
      // as generate_image above only reports "queued", not "delivered".
      const text = interpolatePrompt(action.message, { title: ctx.task.title });
      await slackQueue.add("notify", { webhookUrl: action.webhookUrl, text });
      return { queued: true };
    }
  }
}

/**
 * Runs every enabled automation in the workspace whose trigger matches this
 * event. Called from task.create/task.update/task.bulkUpdate (task.ts)
 * right after their own mutation, activity, and realtime-publish calls —
 * never from inside an action itself, so an action (e.g. set_priority)
 * can't recursively re-fire triggers and cascade.
 */
export async function runAutomationsForTrigger(
  workspaceId: string,
  event: AutomationTriggerEvent,
  task: TriggeringTask,
) {
  const candidates = await db.query.automations.findMany({
    where: eq(schema.automations.workspaceId, workspaceId),
  });

  for (const automation of candidates) {
    if (!automation.enabled) continue;

    const trigger = automationTriggerSchema.parse(automation.triggerJson);
    if (!triggerMatches(trigger, event)) continue;

    const conditions = automationConditionSchema.array().parse(automation.conditionsJson);
    if (!evaluateConditions(conditions, { priority: task.priority })) continue;

    const actions = automationActionSchema.array().parse(automation.actionsJson);
    const log: ActionLogEntry[] = [];
    let status: "success" | "error" = "success";

    for (const action of actions) {
      try {
        const detail = await executeAction(action, {
          workspaceId,
          actorId: automation.createdBy,
          task,
        });
        log.push({ action: action.type, ok: true, detail });
      } catch (err) {
        log.push({
          action: action.type,
          ok: false,
          error: err instanceof Error ? err.message : "Action failed",
        });
        status = "error";
        break;
      }
    }

    await db
      .insert(schema.automationRuns)
      .values({ automationId: automation.id, status, logJson: log });
  }
}
