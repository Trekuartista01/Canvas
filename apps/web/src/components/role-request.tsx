import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  PEOPLE_ROLE_LABELS,
  REQUESTABLE_PEOPLE_ROLES,
  type RequestablePeopleRole,
} from "@canvas/shared";

/** What the person holds; "" is Employee, which needs no approval. */
export type RoleChoice = RequestablePeopleRole | "";

export function RoleRequestSelect({
  value,
  onChange,
}: {
  value: RoleChoice;
  onChange: (value: RoleChoice) => void;
}) {
  return (
    <div className="space-y-1.5 text-left">
      <Label htmlFor="requested-role">Your role</Label>
      <select
        id="requested-role"
        value={value}
        onChange={(e) => onChange(e.target.value as RoleChoice)}
        className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
      >
        <option value="">{PEOPLE_ROLE_LABELS.employee}</option>
        {REQUESTABLE_PEOPLE_ROLES.map((role) => (
          <option key={role} value={role}>
            {PEOPLE_ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      {value && (
        <p className="text-muted-foreground text-xs" data-testid="role-request-note">
          An Admin reviews this first. You'll have Employee access until they approve it.
        </p>
      )}
    </div>
  );
}

/** P8 follow-up: the Admin's queue, at the top of Directory. Admin only. */
export function RoleRequests({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const requests = trpc.people.roleRequests.useQuery({ workspaceId });
  const decide = trpc.people.decideRoleRequest.useMutation({
    onSettled: () => {
      void utils.people.roleRequests.invalidate({ workspaceId });
      void utils.people.directory.invalidate();
      void utils.workspace.members.invalidate();
    },
  });
  const rows = requests.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section
      className="bg-card shadow-sm border-border max-h-56 space-y-2 overflow-y-auto rounded-md border p-3"
      aria-label="Role requests"
      data-testid="role-requests"
    >
      <h2 className="text-base font-semibold">Role requests ({rows.length})</h2>
      <ul className="divide-border divide-y text-sm">
        {rows.map((r) => (
          <li
            key={r.userId}
            className="flex flex-wrap items-center gap-2 py-2"
            data-testid={`role-request-${r.name}`}
          >
            <span className="mr-auto min-w-0">
              <span className="font-medium">{r.name}</span>{" "}
              <span className="text-muted-foreground text-xs">{r.email}</span>
              <span className="block text-xs">
                Asked to be {PEOPLE_ROLE_LABELS[r.requestedRole]}
              </span>
            </span>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ workspaceId, userId: r.userId, approve: true })}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ workspaceId, userId: r.userId, approve: false })}
            >
              Decline
            </Button>
          </li>
        ))}
      </ul>
      {decide.error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {decide.error.message}
        </p>
      )}
    </section>
  );
}
