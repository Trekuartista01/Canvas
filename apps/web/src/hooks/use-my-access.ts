import type { PeopleAction, WorkspaceAction } from "@canvas/shared";
import { trpc } from "@/lib/trpc";

/**
 * What the signed-in user may do in this workspace (people.myAccess) — used
 * to show only the nav sections and controls they can use. Purely
 * presentational: every procedure still runs its own server-side check.
 * `can()` is false while loading, so gated UI appears once access is known.
 */
export function useMyAccess(workspaceId: string) {
  const query = trpc.people.myAccess.useQuery({ workspaceId });
  const actions = new Set(query.data?.actions ?? []);
  return {
    isLoading: query.isLoading,
    peopleRole: query.data?.peopleRole ?? null,
    role: query.data?.role ?? null,
    can: (action: WorkspaceAction | PeopleAction) => actions.has(action),
  };
}
