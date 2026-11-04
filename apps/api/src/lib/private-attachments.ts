import type { SessionUser } from "../auth/session";
import { canViewLeaveDocument } from "./leave";
import { getPeopleContext } from "./membership";
import { isHrFileKey, PRIVATE_PREFIXES } from "./private-upload";

type AttachmentRef = {
  id: string;
  workspaceId: string;
  uploaderId: string;
  fileKey: string | null;
};

/**
 * Who may download a task-less private file, decided by its key prefix
 * (lib/private-upload.ts). null = not a private file — the normal
 * workspace attachment:view check applies.
 */
export async function canViewPrivateAttachment(
  user: SessionUser,
  attachment: AttachmentRef,
): Promise<boolean | null> {
  const key = attachment.fileKey ?? "";
  if (key.startsWith(PRIVATE_PREFIXES.leave)) return canViewLeaveDocument(user, attachment);
  // P8.6 (spec §1): contract and other HR files are never streamed here —
  // only through the contract router's 5-minute signed links, which check
  // the role first.
  if (isHrFileKey(key)) return false;
  if (key.startsWith(PRIVATE_PREFIXES.companyDocument)) {
    return Boolean(await getPeopleContext(attachment.workspaceId, user.id));
  }
  return null;
}
