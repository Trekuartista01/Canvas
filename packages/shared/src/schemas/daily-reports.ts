import { z } from "zod";

// M7.3 daily reports. The report date is never client-supplied on save — the
// server always saves "today" in Kosovo time (see ../daily-reports.ts).
export const saveDailyReportSchema = z.object({
  workspaceId: z.string().uuid(),
  // TipTap JSON — rich text is never an HTML string (CLAUDE.md).
  bodyJson: z.record(z.unknown()),
});

export const dailyReportTeamSchema = z.object({
  workspaceId: z.string().uuid(),
  reportDate: z.string().date(),
});

export const dailyReportIdSchema = z.object({ reportId: z.string().uuid() });
