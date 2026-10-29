import { z } from "zod";
import { emailSchema } from "./auth";
import { MEMBERSHIP_ROLES } from "../roles";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const inviteMemberSchema = z.object({
  workspaceId: z.string().uuid(),
  email: emailSchema,
  role: z.enum(MEMBERSHIP_ROLES).exclude(["owner"]),
  customRoleId: z.string().uuid().optional(),
});

export const acceptInviteSchema = z.object({
  inviteId: z.string().uuid(),
});

export const listMembersSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const updateMemberRoleSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  // Ownership transfer isn't in scope here — only one owner, set at
  // workspace creation.
  role: z.enum(MEMBERSHIP_ROLES).exclude(["owner"]),
});

export const removeMemberSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
