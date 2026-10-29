import type { WorkspaceAction } from "@canvas/shared";

/**
 * Human labels for the raw `resource` prefix of a `WorkspaceAction` (e.g.
 * "hierarchy" out of "hierarchy:create") — the roles/permissions page is the
 * one place these internal resource names would otherwise leak into the UI
 * verbatim (camelCase, developer-facing names like "customFieldDef").
 */
const RESOURCE_LABELS: Record<string, string> = {
  workspace: "Workspace",
  hierarchy: "Spaces & lists",
  status: "Statuses",
  task: "Tasks",
  comment: "Comments",
  tag: "Tags",
  customFieldDef: "Custom fields",
  customFieldValue: "Custom field values",
  attachment: "Attachments",
  imageAsset: "Generated images",
  imageFolder: "Library folders",
  brain: "Brain (AI assistant)",
  brandSettings: "Brand settings",
  taskTemplate: "Task templates",
  doc: "Docs",
  form: "Forms",
  automation: "Automations",
  dashboard: "Dashboards",
  customRole: "Custom roles",
  spaceOverride: "Space permission overrides",
  export: "Data export",
  timeEntry: "Time tracking",
};

export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource;
}

/** e.g. "task:create" -> "Tasks — create". */
export function actionLabel(action: WorkspaceAction): string {
  const [resource, verb] = action.split(":");
  return `${resourceLabel(resource!)} — ${verb}`;
}

/** e.g. "role:member" -> "Member"; "customRole:<id>" -> that role's name. */
export function principalLabel(
  principal: string,
  customRoles: { id: string; name: string }[],
): string {
  const [kind, value] = principal.split(":", 2);
  if (kind === "role" && value) return value.charAt(0).toUpperCase() + value.slice(1);
  if (kind === "customRole" && value) {
    const role = customRoles.find((r) => r.id === value);
    return role ? role.name : "Deleted custom role";
  }
  return principal;
}
