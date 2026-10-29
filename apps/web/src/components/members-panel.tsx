import type { AppRouter } from "@canvas/api";
import { MEMBERSHIP_ROLES, PEOPLE_ROLE_LABELS, type MembershipRole } from "@canvas/shared";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Member = RouterOutputs["workspace"]["members"][number];

type EditableRole = Exclude<MembershipRole, "owner">;
const EDITABLE_ROLES = MEMBERSHIP_ROLES.filter((r): r is EditableRole => r !== "owner");

export function MembersPanel({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const mine = trpc.workspace.listMine.useQuery();
  const myRole = mine.data?.find((w) => w.workspace.id === workspaceId)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const members = trpc.workspace.members.useQuery({ workspaceId });
  const customRoles = trpc.role.list.useQuery({ workspaceId }, { enabled: canManage });
  // Also invalidate listMine: a role change can target the current user
  // themselves (e.g. self-demotion), and canManage above is derived from
  // listMine — without this it stays stale (still showing management
  // controls) until an unrelated reload happens to refetch it.
  const invalidate = () => {
    utils.workspace.members.invalidate({ workspaceId });
    utils.workspace.listMine.invalidate();
  };
  const updateRole = trpc.workspace.updateMemberRole.useMutation({ onSuccess: invalidate });
  const removeMember = trpc.workspace.removeMember.useMutation({ onSuccess: invalidate });
  const assignCustomRole = trpc.role.assignToMember.useMutation({ onSuccess: invalidate });

  return (
    <div className="w-full max-w-md space-y-2 p-6">
      <h2 className="text-sm font-medium">Members</h2>
      <ul className="divide-border divide-y rounded-md border">
        {(members.data ?? []).map((m: Member) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 p-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{m.name}</p>
              <p className="text-muted-foreground truncate text-xs">{m.email}</p>
            </div>
            {canManage ? (
              <div className="flex shrink-0 items-center gap-2">
                {m.role !== "owner" && (
                  <>
                    <select
                      value={m.role}
                      aria-label={`Role for ${m.name}`}
                      onChange={(e) =>
                        updateRole.mutate({
                          workspaceId,
                          userId: m.userId,
                          role: e.target.value as EditableRole,
                        })
                      }
                      className="border-border bg-background h-7 rounded border text-xs"
                    >
                      {EDITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {(customRoles.data?.length ?? 0) > 0 && (
                      <select
                        value={m.customRoleId ?? ""}
                        aria-label={`Custom role for ${m.name}`}
                        onChange={(e) =>
                          assignCustomRole.mutate({
                            workspaceId,
                            userId: m.userId,
                            customRoleId: e.target.value || null,
                          })
                        }
                        className="border-border bg-background h-7 rounded border text-xs"
                      >
                        <option value="">No custom role</option>
                        {customRoles.data?.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
                {m.role !== "owner" && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    title={`Remove ${m.name}`}
                    onClick={() => removeMember.mutate({ workspaceId, userId: m.userId })}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <span className="flex shrink-0 items-center gap-1.5 text-xs">
                {m.peopleRole !== "staff" && (
                  <span className="bg-accent-soft text-accent rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                    {PEOPLE_ROLE_LABELS[m.peopleRole]}
                  </span>
                )}
                <span className="text-muted-foreground uppercase">
                  {m.customRoleName ?? m.role}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
