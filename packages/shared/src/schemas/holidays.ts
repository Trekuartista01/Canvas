import { z } from "zod";

// Official holidays (M7.4, P8.2) — each row is one concrete day off; see
// ../holidays.ts (seed) and ../working-days.ts (counting).
export const listHolidaysSchema = z.object({
  workspaceId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
});

const holidayName = z.string().trim().min(1).max(120);

export const createHolidaySchema = z.object({
  workspaceId: z.string().uuid(),
  date: z.string().date(),
  nameSq: holidayName,
  nameEn: holidayName,
  isObservedSubstitute: z.boolean().default(false),
});

export const updateHolidaySchema = z.object({
  holidayId: z.string().uuid(),
  date: z.string().date().optional(),
  nameSq: holidayName.optional(),
  nameEn: holidayName.optional(),
  isObservedSubstitute: z.boolean().optional(),
});

export const holidayIdSchema = z.object({ holidayId: z.string().uuid() });

export const setHolidayNoticeDaysSchema = z.object({
  workspaceId: z.string().uuid(),
  days: z.number().int().min(0).max(30),
});

export const setHolidayWeekendSubstitutionSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
});

export const holidayReminderSchema = z.object({ workspaceId: z.string().uuid() });
