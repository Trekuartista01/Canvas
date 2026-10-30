import { db, schema } from "@canvas/db";
import { and, eq, isNull } from "drizzle-orm";
import type { SessionUser } from "../auth/session";
import { canViewLeaveDocument } from "./leave";
import { getPeopleContext } from "./membership";
import { canPeopleAction } from "./permissions";
import { PRIVATE_PREFIXES } from "./private-upload";

type AttachmentRef = {
  id: string;
  workspaceId: string;
  uploaderId: string;
  fileKey: string | null;
};

/** The employee whose current contract file this is, or HR. Old/unlinked files: HR only. */
export async function canViewContractFile(user: SessionUser, attachment: AttachmentRef) {
  if (await canPeopleAction(user, attachment.workspaceId, "contract:manage")) return true;
  const contract = await db.query.employmentContracts.findFirst({
    where: and(
      eq(schema.employmentContracts.attachmentId, attachment.id),
      isNull(schema.employmentContracts.deletedAt),
    ),
  });
  return (
    contract?.userId === user.id && Boolean(await getPeopleContext(attachment.workspaceId, user.id))
  );
}

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
  if (key.startsWith(PRIVATE_PREFIXES.contract)) return canViewContractFile(user, attachment);
  if (key.startsWith(PRIVATE_PREFIXES.companyDocument)) {
    return Boolean(await getPeopleContext(attachment.workspaceId, user.id));
  }
  return null;
}
