import { z } from "zod";

const workspaceId = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const aliases = z.array(z.string().trim().min(1).max(120)).max(30);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_LOGO_BYTES = 5 * 1024 ** 2;

export const listClientsSchema = z.object({
  workspaceId,
  includeArchived: z.boolean().default(false),
});

export const clientIdSchema = z.object({ clientId: z.string().uuid() });

export const createClientSchema = z.object({
  workspaceId,
  name,
  aliases: aliases.default([]),
  color: color.optional(),
});

export const updateClientSchema = z.object({
  clientId: z.string().uuid(),
  name: name.optional(),
  aliases: aliases.optional(),
  color: color.optional(),
  // From presignClientLogo, after the upload. null removes the logo.
  logoKey: z.string().min(1).max(500).nullable().optional(),
});

export const setClientArchivedSchema = z.object({
  clientId: z.string().uuid(),
  archived: z.boolean(),
});

export const presignClientLogoSchema = z.object({
  clientId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(300),
  mime: z.enum(LOGO_MIME_TYPES),
});

// A card's Client field. null clears it. Either way it stops auto-detection.
export const setTaskClientSchema = z.object({
  taskId: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
});
