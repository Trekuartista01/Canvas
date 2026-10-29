import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { actionLabel, principalLabel, resourceLabel } from "@/lib/permission-labels";
import { trpc } from "@/lib/trpc";
import {
  MEMBERSHIP_ROLES,
  WORKSPACE_ACTIONS,
  type MembershipRole,
  type WorkspaceAction,
} from "@canvas/shared";
import { createRoute } from "@tanstack/react-router";
import { Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const rolesRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/roles",
  component: RolesPage,
});

// Owner-tier actions (workspace:delete) are rejected server-side (can.ts's
// isGrantable) if granted via a custom role or space override — hidden here
// too so the checkbox list only offers what will actually save.
const NON_GRANTABLE = new Set<WorkspaceAction>(["workspace:delete"]);
const GRANTABLE_ACTIONS = WORKSPACE_ACTIONS.filter((a) => !NON_GRANTABLE.has(a));

// Only actions actually wired to consult a space override (hierarchy/status/
// task create+update+delete — see PROGRESS.md's Phase 6 entry) are offered
// in the space-override picker; the rest would silently never apply.
const SPACE_SCOPED_ACTIONS = GRANTABLE_ACTIONS.filter(
  (a) =>
    a.startsWith("hierarchy:") ||
    a.startsWith("status:") ||
    (a.startsWith("task:") && a !== "task:view"),
);

// Quick-start presets for the custom-role builder below — pre-fill the
// name/baseRole/grants/revokes fields (not auto-submitted, still editable)
// for the org roles this app is commonly set up with.
const ROLE_TEMPLATES: {
  name: string;
  description: string;
  baseRole: Exclude<MembershipRole, "owner">;
  grants: WorkspaceAction[];
  revokes: WorkspaceAction[];
}[] = [
  {
    name: "Operations Manager",
    description: "Creates and assigns tasks like any member — a named role for clarity.",
    baseRole: "member",
    grants: [],
    revokes: [],
  },
  {
    name: "Finance Manager",
    description: "Adds the workspace-wide time & AI-cost view on the Timesheet page.",
    baseRole: "member",
    grants: ["timeEntry:viewAll"],
    revokes: [],
  },
  {
    name: "Staff",
    description: "Works assigned tasks but can't create new ones.",
    baseRole: "member",
    grants: [],
    revokes: ["task:create"],
  },
];

function groupByResource(actions: WorkspaceAction[]) {
  const groups = new Map<string, WorkspaceAction[]>();
  for (const action of actions) {
    const resource = action.split(":")[0]!;
    if (!groups.has(resource)) groups.set(resource, []);
    groups.get(resource)!.push(action);
  }
  return [...groups.entries()];
}

function RolesPage() {
  const { workspaceId } = rolesRoute.useParams();

  return (
    <div className="space-y-6 p-6" data-testid="roles-page">
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Roles &amp; permissions</h1>
          <p className="text-muted-foreground text-xs">
            Build a custom role by starting from a base role and adjusting individual permissions,
            or override one permission for everything inside a single space.
          </p>
        </div>
      </div>

      <CustomRolesSection workspaceId={workspaceId} />
      <SpaceOverridesSection workspaceId={workspaceId} />
    </div>
  );
}

// A checkbox visually rendered as a pill — `.check()`/`.uncheck()` in
// Playwright still targets a real `<input type="checkbox">`, so existing
// e2e locators (`getByLabel("Grant ...")`) keep working unchanged; only the
// visual treatment (hidden input + styled sibling) is new.
function TogglePill({
  label,
  tone,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  tone: "good" | "critical";
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const activeClass =
    tone === "good"
      ? "has-[:checked]:border-status-good has-[:checked]:bg-status-good/15 has-[:checked]:text-status-good"
      : "has-[:checked]:border-status-critical has-[:checked]:bg-status-critical/15 has-[:checked]:text-status-critical";

  return (
    <label
      className={`border-border text-muted-foreground relative inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${activeClass}`}
    >
      {label}
      <input
        type="checkbox"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={ariaLabel}
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
}

function CustomRolesSection({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const roles = trpc.role.list.useQuery({ workspaceId });
  const invalidate = () => utils.role.list.invalidate({ workspaceId });
  const createRole = trpc.role.create.useMutation({ onSuccess: invalidate });
  const deleteRole = trpc.role.delete.useMutation({ onSuccess: invalidate });

  const [name, setName] = useState("");
  const [baseRole, setBaseRole] = useState<Exclude<MembershipRole, "owner">>("member");
  const [grants, setGrants] = useState<Set<WorkspaceAction>>(new Set());
  const [revokes, setRevokes] = useState<Set<WorkspaceAction>>(new Set());
  const [filterText, setFilterText] = useState("");

  function toggle(
    set: Set<WorkspaceAction>,
    setSet: (s: Set<WorkspaceAction>) => void,
    action: WorkspaceAction,
  ) {
    const next = new Set(set);
    if (next.has(action)) next.delete(action);
    else next.add(action);
    setSet(next);
  }

  function handleCreate() {
    if (!name.trim()) return;
    createRole.mutate(
      {
        workspaceId,
        name: name.trim(),
        baseRole,
        grants: [...grants],
        revokes: [...revokes],
      },
      {
        onSuccess: () => {
          setName("");
          setGrants(new Set());
          setRevokes(new Set());
        },
      },
    );
  }

  const filter = filterText.trim().toLowerCase();
  const groups = useMemo(() => {
    const all = groupByResource(GRANTABLE_ACTIONS);
    if (!filter) return all;
    return all
      .map(([resource, actions]) => {
        const resourceMatches = resourceLabel(resource).toLowerCase().includes(filter);
        const matchingActions = resourceMatches
          ? actions
          : actions.filter((a) => actionLabel(a).toLowerCase().includes(filter));
        return [resource, matchingActions] as const;
      })
      .filter(([, actions]) => actions.length > 0);
  }, [filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom roles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">
          A custom role starts from a base role's permissions, then grants or revokes individual
          actions on top. Assign it to a member from the workspace's Members list.
        </p>

        <div className="flex flex-wrap gap-2">
          {ROLE_TEMPLATES.map((template) => (
            <button
              key={template.name}
              type="button"
              title={template.description}
              data-testid={`role-template-${template.name.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => {
                setName(template.name);
                setBaseRole(template.baseRole);
                setGrants(new Set(template.grants));
                setRevokes(new Set(template.revokes));
              }}
              className="border-border hover:bg-muted rounded-full border px-3 py-1 text-xs font-medium"
            >
              {template.name}
            </button>
          ))}
        </div>

        {(roles.data?.length ?? 0) > 0 && (
          <ul className="divide-border divide-y rounded-md border" data-testid="custom-role-list">
            {roles.data?.map((role) => {
              const grantCount = (role.grants as string[]).length;
              const revokeCount = (role.revokes as string[]).length;
              return (
                <li
                  key={role.id}
                  className="flex items-center justify-between gap-2 p-2.5 text-sm"
                  data-testid={`custom-role-${role.id}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="bg-accent-soft text-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{role.name}</p>
                      <p className="text-muted-foreground truncate text-xs capitalize">
                        Based on {role.baseRole}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {grantCount > 0 && (
                      <span className="bg-status-good/15 text-status-good rounded-full px-2 py-0.5 text-[10px] font-medium">
                        +{grantCount}
                      </span>
                    )}
                    {revokeCount > 0 && (
                      <span className="bg-status-critical/15 text-status-critical rounded-full px-2 py-0.5 text-[10px] font-medium">
                        −{revokeCount}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRole.mutate({ customRoleId: role.id })}
                      aria-label={`Delete ${role.name}`}
                      title={`Delete ${role.name}`}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Role name"
              className="h-8 max-w-xs text-sm"
              data-testid="custom-role-name"
            />
            <label className="flex items-center gap-1 text-xs">
              Base role
              <select
                value={baseRole}
                onChange={(e) => setBaseRole(e.target.value as Exclude<MembershipRole, "owner">)}
                className="border-border bg-background h-8 rounded border text-sm"
                data-testid="custom-role-base"
              >
                {MEMBERSHIP_ROLES.filter((r) => r !== "owner").map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="relative max-w-xs">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter permissions…"
              className="h-8 pl-7 text-sm"
              aria-label="Filter permissions"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {groups.map(([resource, actions]) => (
              <div key={resource} className="border-border rounded-md border p-2.5">
                <p className="mb-1.5 text-xs font-semibold">{resourceLabel(resource)}</p>
                <div className="space-y-1.5">
                  {actions.map((action) => (
                    <div key={action} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground truncate">
                        {actionLabel(action).replace(`${resourceLabel(resource)} — `, "")}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <TogglePill
                          label="Grant"
                          tone="good"
                          checked={grants.has(action)}
                          onChange={() => toggle(grants, setGrants, action)}
                          ariaLabel={`Grant ${action}`}
                        />
                        <TogglePill
                          label="Revoke"
                          tone="critical"
                          checked={revokes.has(action)}
                          onChange={() => toggle(revokes, setRevokes, action)}
                          ariaLabel={`Revoke ${action}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <p className="text-muted-foreground col-span-2 text-xs">
                No permissions match "{filterText}".
              </p>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={createRole.isPending || !name.trim()}
            data-testid="custom-role-create"
          >
            Create role
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SpaceOverridesSection({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });
  const roles = trpc.role.list.useQuery({ workspaceId });
  const [spaceId, setSpaceId] = useState<string>("");

  const overrides = trpc.role.spaceOverride.list.useQuery({ spaceId }, { enabled: spaceId !== "" });
  const invalidate = () => utils.role.spaceOverride.list.invalidate({ spaceId });
  const setOverride = trpc.role.spaceOverride.set.useMutation({ onSuccess: invalidate });
  const deleteOverride = trpc.role.spaceOverride.delete.useMutation({ onSuccess: invalidate });

  const [principal, setPrincipal] = useState("role:member");
  const [action, setAction] = useState<WorkspaceAction>("task:create");
  const [allow, setAllow] = useState(true);

  function handleAdd() {
    if (!spaceId) return;
    const [kind, value] = principal.split(":", 2) as ["role" | "customRole", string];
    setOverride.mutate({
      spaceId,
      action,
      allow,
      ...(kind === "role" ? { role: value as MembershipRole } : { customRoleId: value }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Space permissions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">
          Override the default allow/deny for one action, scoped to everything under a single space
          — the most specific layer, ahead of custom roles and base ranks.
        </p>

        <label className="flex items-center gap-2 text-xs">
          Space
          <select
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            className="border-border bg-background h-8 rounded border text-sm"
            data-testid="space-override-space"
          >
            <option value="">Select a space…</option>
            {tree.data?.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>

        {spaceId && (
          <>
            {(overrides.data?.length ?? 0) > 0 && (
              <ul
                className="divide-border divide-y rounded-md border"
                data-testid="space-override-list"
              >
                {overrides.data?.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="bg-accent-soft text-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <div className="min-w-0 text-xs">
                        <p className="truncate font-medium">
                          {principalLabel(o.principal, roles.data ?? [])}
                        </p>
                        <p className="text-muted-foreground truncate">
                          {actionLabel(o.action as WorkspaceAction)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          o.allow
                            ? "bg-status-good/15 text-status-good"
                            : "bg-status-critical/15 text-status-critical"
                        }`}
                      >
                        {o.allow ? "allowed" : "denied"}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteOverride.mutate({ overrideId: o.id })}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <select
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                className="border-border bg-background h-8 rounded border text-sm"
                data-testid="space-override-principal"
              >
                <optgroup label="Role">
                  {MEMBERSHIP_ROLES.filter((r) => r !== "owner").map((r) => (
                    <option key={r} value={`role:${r}`}>
                      {r}
                    </option>
                  ))}
                </optgroup>
                {(roles.data?.length ?? 0) > 0 && (
                  <optgroup label="Custom role">
                    {roles.data?.map((r) => (
                      <option key={r.id} value={`customRole:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>

              <select
                value={action}
                onChange={(e) => setAction(e.target.value as WorkspaceAction)}
                className="border-border bg-background h-8 rounded border text-sm"
                data-testid="space-override-action"
              >
                {SPACE_SCOPED_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(a)}
                  </option>
                ))}
              </select>

              <select
                value={allow ? "allow" : "deny"}
                onChange={(e) => setAllow(e.target.value === "allow")}
                className="border-border bg-background h-8 rounded border text-sm"
                data-testid="space-override-allow"
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>

              <Button
                type="button"
                size="sm"
                onClick={handleAdd}
                disabled={setOverride.isPending}
                data-testid="space-override-add"
              >
                Add override
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
