import { activityRouter } from "./routers/activity";
import { adminRouter } from "./routers/admin";
import { aiUsageRouter } from "./routers/ai-usage";
import { attachmentRouter } from "./routers/attachment";
import { authRouter } from "./routers/auth";
import { automationRouter } from "./routers/automation";
import { brainRouter } from "./routers/brain";
import { brandKitRouter } from "./routers/brand-kit";
import { checklistRouter } from "./routers/checklist";
import { commentRouter } from "./routers/comment";
import { copywriterRouter } from "./routers/copywriter";
import { customFieldRouter } from "./routers/custom-field";
import { dashboardRouter } from "./routers/dashboard";
import { docRouter } from "./routers/doc";
import { formRouter } from "./routers/form";
import { hierarchyRouter } from "./routers/hierarchy";
import { imageAssetRouter } from "./routers/image-asset";
import { imageFolderRouter } from "./routers/image-folder";
import { notificationRouter } from "./routers/notification";
import { reminderRouter } from "./routers/reminder";
import { roleRouter } from "./routers/role";
import { searchRouter } from "./routers/search";
import { statusRouter } from "./routers/status";
import { tagRouter } from "./routers/tag";
import { taskRouter } from "./routers/task";
import { taskTemplateRouter } from "./routers/task-template";
import { timeEntryRouter } from "./routers/time-entry";
import { peopleRouter } from "./routers/people";
import { dailyReportRouter } from "./routers/daily-report";
import { holidayRouter } from "./routers/holiday";
import { leaveRouter } from "./routers/leave";
import { contractRouter } from "./routers/contract";
import { companyDocumentRouter } from "./routers/company-document";
import { payrollRouter } from "./routers/payroll";
import { workloadRouter } from "./routers/workload";
import { workspaceRouter } from "./routers/workspace";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  auth: authRouter,
  workspace: workspaceRouter,
  hierarchy: hierarchyRouter,
  status: statusRouter,
  task: taskRouter,
  checklist: checklistRouter,
  comment: commentRouter,
  notification: notificationRouter,
  reminder: reminderRouter,
  activity: activityRouter,
  admin: adminRouter,
  tag: tagRouter,
  taskTemplate: taskTemplateRouter,
  timeEntry: timeEntryRouter,
  workload: workloadRouter,
  customField: customFieldRouter,
  attachment: attachmentRouter,
  imageAsset: imageAssetRouter,
  imageFolder: imageFolderRouter,
  brandKit: brandKitRouter,
  brain: brainRouter,
  copywriter: copywriterRouter,
  doc: docRouter,
  form: formRouter,
  automation: automationRouter,
  dashboard: dashboardRouter,
  role: roleRouter,
  people: peopleRouter,
  dailyReport: dailyReportRouter,
  holiday: holidayRouter,
  leave: leaveRouter,
  contract: contractRouter,
  companyDocument: companyDocumentRouter,
  payroll: payrollRouter,
  search: searchRouter,
  aiUsage: aiUsageRouter,
});

export type AppRouter = typeof appRouter;
