import { z } from "zod";

// M7.4 public holiday calendar — see ../holidays.ts for the observed rule.
export const listHolidaysSchema = z.object({
  workspaceId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
});

export const createHolidaySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  date: z.string().date(),
  isRecurringFixed: z.boolean().default(false),
  // HR override of the observed day (movable holidays only); null = by the rule.
  observedDate: z.string().date().nullable().optional(),
});

export const updateHolidaySchema = z.object({
  holidayId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  date: z.string().date().optional(),
  isRecurringFixed: z.boolean().optional(),
  observedDate: z.string().date().nullable().optional(),
});

export const holidayIdSchema = z.object({ holidayId: z.string().uuid() });

export const setHolidayNoticeDaysSchema = z.object({
  workspaceId: z.string().uuid(),
  days: z.number().int().min(0).max(30),
});
