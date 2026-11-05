import { RoleRequestSelect, type RoleChoice } from "@/components/role-request";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { trpc } from "@/lib/trpc";
import { PEOPLE_ROLE_LABELS } from "@canvas/shared";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { rootRoute } from "./__root";

export const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$inviteId",
  component: InvitePage,
});

function InvitePage() {
  const { inviteId } = inviteRoute.useParams();
  const { user, isLoading: sessionLoading } = useSession();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const invite = trpc.workspace.getInvite.useQuery({ inviteId });
  const [requestedRole, setRequestedRole] = useState<RoleChoice>("");

  const accept = trpc.workspace.acceptInvite.useMutation({
    onSuccess: async () => {
      await utils.workspace.listMine.invalidate();
      navigate({ to: "/" });
    },
  });

  if (invite.isLoading || sessionLoading) {
    return <p className="text-muted-foreground p-8 text-sm">Loading…</p>;
  }

  if (!invite.data || invite.data.expired || invite.data.accepted) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-2 px-4 text-center">
        <p>This invite link is no longer valid.</p>
        <Link to="/login" className="text-sm underline">
          Log in
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <p>
        You've been invited to join <strong>{invite.data.workspaceName}</strong>
      </p>

      {!user && (
        <div className="flex gap-3">
          <Link to="/signup" search={{ invite: inviteId }} className="text-sm underline">
            Sign up with {invite.data.email}
          </Link>
          <Link
            to="/login"
            search={{ redirect: `/invite/${inviteId}` }}
            className="text-sm underline"
          >
            Log in
          </Link>
        </div>
      )}

      {user && user.email !== invite.data.email && (
        <p className="text-sm text-red-500">
          This invite was sent to {invite.data.email}, but you're logged in as {user.email}.
        </p>
      )}

      {user && user.email === invite.data.email && (
        <div className="w-full max-w-sm space-y-4">
          {invite.data.peopleRole ? (
            <p className="text-muted-foreground text-sm" data-testid="invite-role">
              You'll join as {PEOPLE_ROLE_LABELS[invite.data.peopleRole]}.
            </p>
          ) : (
            <RoleRequestSelect value={requestedRole} onChange={setRequestedRole} />
          )}
          <Button
            onClick={() => accept.mutate({ inviteId, ...(requestedRole ? { requestedRole } : {}) })}
            disabled={accept.isPending}
          >
            {accept.isPending ? "Joining…" : `Accept & join ${invite.data.workspaceName}`}
          </Button>
        </div>
      )}
    </main>
  );
}
