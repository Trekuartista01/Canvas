import { z } from "zod";

const workspaceId = z.string().uuid();

// M7.8 — a Kosovo-date range, both ends inclusive.
export const performanceRangeSchema = z
  .object({ workspaceId, from: z.string().date(), to: z.string().date() })
  .refine((v) => v.from <= v.to, { message: "The range ends before it starts", path: ["to"] });

export const performanceEmployeeSchema = z
  .object({
    workspaceId,
    userId: z.string().uuid(),
    from: z.string().date(),
    to: z.string().date(),
  })
  .refine((v) => v.from <= v.to, { message: "The range ends before it starts", path: ["to"] });
