import { useMyAccess } from "@/hooks/use-my-access";
import type { PeopleAction, WorkspaceAction } from "@canvas/shared";
import type { ReactNode } from "react";

/**
 * P8.7: the client half of a page guard, for someone who opens a hidden
 * page's URL directly. The page isn't mounted without the permission, so its
 * queries never run. The server still checks every request itself.
 */
export function RequireAccess({
  workspaceId,
  action,
  children,
}: {
  workspaceId: string;
  action: WorkspaceAction | PeopleAction;
  children: ReactNode;
}) {
  const access = useMyAccess(workspaceId);
  if (access.isLoading) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }
  if (!access.can(action)) {
    return (
      <p className="text-muted-foreground p-6 text-sm" data-testid="no-access">
        You don't have access to this page.
      </p>
    );
  }
  return <>{children}</>;
}
