import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { accountRoute } from "./routes/account";
import { inviteRoute } from "./routes/invite.$inviteId";
import { loginRoute } from "./routes/login";
import { signupRoute } from "./routes/signup";
import { privacyRoute } from "./routes/privacy";
import { termsRoute } from "./routes/terms";
import { publicFormRoute } from "./routes/forms.$publicToken";
import { workspaceShellRoute } from "./routes/workspace.$workspaceId";
import { workspaceHomeRoute } from "./routes/workspace.$workspaceId.index";
import { listRoute } from "./routes/workspace.$workspaceId.list.$listId";
import { timesheetRoute } from "./routes/workspace.$workspaceId.timesheet";
import { workloadRoute } from "./routes/workspace.$workspaceId.workload";
import { docsListRoute } from "./routes/workspace.$workspaceId.docs";
import { docEditorRoute } from "./routes/workspace.$workspaceId.docs.$docId";
import { formsListRoute } from "./routes/workspace.$workspaceId.forms";
import { formEditorRoute } from "./routes/workspace.$workspaceId.forms.$formId";
import { automationsListRoute } from "./routes/workspace.$workspaceId.automations";
import { automationEditorRoute } from "./routes/workspace.$workspaceId.automations.$automationId";
import { brandKitsRoute } from "./routes/workspace.$workspaceId.brand-kits";
import { copywriterListRoute } from "./routes/workspace.$workspaceId.copywriter";
import { copywriterWorkspaceRoute } from "./routes/workspace.$workspaceId.copywriter.$brandKitId";
import { copywriterHistoryRoute } from "./routes/workspace.$workspaceId.copywriter.history";
import { dashboardsListRoute } from "./routes/workspace.$workspaceId.dashboards";
import { dashboardEditorRoute } from "./routes/workspace.$workspaceId.dashboards.$dashboardId";
import { libraryRoute } from "./routes/workspace.$workspaceId.library";
import { rolesRoute } from "./routes/workspace.$workspaceId.roles";
import { adminRoute } from "./routes/workspace.$workspaceId.admin";
import { semanticSearchRoute } from "./routes/workspace.$workspaceId.semantic-search";
import { newWorkspaceRoute } from "./routes/workspaces.new";

const routeTree = rootRoute.addChildren([
  indexRoute,
  accountRoute,
  loginRoute,
  signupRoute,
  privacyRoute,
  termsRoute,
  newWorkspaceRoute,
  inviteRoute,
  publicFormRoute,
  workspaceShellRoute.addChildren([
    workspaceHomeRoute,
    listRoute,
    timesheetRoute,
    workloadRoute,
    docsListRoute,
    docEditorRoute,
    formsListRoute,
    formEditorRoute,
    automationsListRoute,
    automationEditorRoute,
    dashboardsListRoute,
    dashboardEditorRoute,
    adminRoute,
    rolesRoute,
    brandKitsRoute,
    semanticSearchRoute,
    libraryRoute,
    copywriterListRoute,
    copywriterHistoryRoute,
    copywriterWorkspaceRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
