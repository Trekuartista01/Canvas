import { z } from "zod";

const name = z.string().trim().min(1).max(100);

export const listSpacesSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const createSpaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name,
  icon: z.string().trim().max(50).optional(),
});

export const updateSpaceSchema = z.object({
  spaceId: z.string().uuid(),
  name: name.optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  brandKitId: z.string().uuid().nullable().optional(),
});

export const deleteSpaceSchema = z.object({
  spaceId: z.string().uuid(),
});

export const createFolderSchema = z.object({
  spaceId: z.string().uuid(),
  name,
});

export const updateFolderSchema = z.object({
  folderId: z.string().uuid(),
  name,
});

export const deleteFolderSchema = z.object({
  folderId: z.string().uuid(),
});

export const createListSchema = z.object({
  spaceId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  name,
});

export const updateListSchema = z.object({
  listId: z.string().uuid(),
  name: name.optional(),
  folderId: z.string().uuid().nullable().optional(),
  // P8.9: a new position among the board's lists.
  orderKey: z.string().min(1).optional(),
});

// P8.9: archive a list, or bring it back.
export const setListArchivedSchema = z.object({
  listId: z.string().uuid(),
  archived: z.boolean(),
});

export const boardMembersSchema = z.object({ spaceId: z.string().uuid() });

export const boardMemberSchema = z.object({
  spaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const deleteListSchema = z.object({
  listId: z.string().uuid(),
});

export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
