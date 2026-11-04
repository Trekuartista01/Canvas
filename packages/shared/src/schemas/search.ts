import { z } from "zod";

// Phase 6: semantic + visual search (pgvector).

export const tasksByTextSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
});

// P8.8: people and work in one box, scoped by the server (lib/global-search.ts).
export const globalSearchSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().trim().min(1).max(200),
});

export const imagesLikeThisSchema = z.object({
  imageAssetId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(10),
});
