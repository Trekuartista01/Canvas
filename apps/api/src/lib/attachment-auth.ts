import type { SessionUser } from "../auth/session";
import { assertCan } from "./permissions";
import { workspaceIdForTask } from "./task-queries";

/**
 * Resolves the workspace a task attachment is going into and checks the
 * caller can actually create an attachment there. Shared by
 * attachment.presignUpload/confirmUpload so the two don't drift out of sync
 * with each other or with the plain REST download route's equivalent check.
 */
export async function requireAttachmentTarget(
  user: SessionUser,
  target: { taskId: string },
): Promise<{ workspaceId: string }> {
  const workspaceId = await workspaceIdForTask(target.taskId);
  await assertCan(user, workspaceId, "attachment:create");
  return { workspaceId };
}
