import { BrainChatPanel } from "@/components/brain-chat-panel";
import { CanvasLogo } from "@/components/canvas-logo";
import { GenerationPanel } from "@/components/generation-panel";
import { HierarchySidebar } from "@/components/hierarchy-sidebar";
import { LoginSummaryPanel } from "@/components/login-summary-panel";
import { NotificationsBell } from "@/components/notifications-bell";
import { RequireAuth } from "@/components/require-auth";
import { RunningTimerWidget } from "@/components/running-timer-widget";
import { SearchBox } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { WorkspaceNav } from "@/components/workspace-nav";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { useRealtime } from "@/hooks/use-realtime";
import { useSession } from "@/hooks/use-session";
import { Avatar } from "@/lib/avatar";
import { trpc } from "@/lib/trpc";
import {
  createRoute,
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { ChevronLeft, LogOut, Menu, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { rootRoute } from "./__root";

export const workspaceShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspaceId",
  component: () => (
    <RequireAuth>
      <WorkspaceShell />
    </RequireAuth>
  ),
});

function WorkspaceShell() {
  const { workspaceId, listId } = useParams({ strict: false });
  const workspaces = trpc.workspace.listMine.useQuery();
  const membership = workspaces.data?.find((w) => w.workspace.id === workspaceId);
  const workspace = membership?.workspace;
  const { user } = useSession();
  const navigate = useNavigate();
  const logOut = trpc.auth.logOut.useMutation({
    onSuccess: () => navigate({ to: "/login" }),
  });
  const [brainOpen, setBrainOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { containerRef: generatePanelRef, onKeyDown: generatePanelOnKeyDown } = useModalA11y(
    () => setGenerateOpen(false),
    generateOpen,
  );

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { containerRef: sidebarRef, onKeyDown: sidebarOnKeyDown } = useModalA11y(
    () => setMobileNavOpen(false),
    mobileNavOpen,
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useRealtime(workspaceId);

  return (
    <div className="flex h-svh flex-col md:flex-row">
      <div className="workspace-sidebar border-border bg-card text-foreground flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Open navigation menu"
          aria-expanded={mobileNavOpen}
          title="Open navigation menu"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
        <CanvasLogo size={32} />
      </div>
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Dismiss navigation menu overlay"
          title="Dismiss navigation menu overlay"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        onKeyDown={sidebarOnKeyDown}
        // Only a real modal dialog while acting as the mobile off-canvas
        // overlay — on desktop this is a normal persistent, non-modal
        // sidebar, and asserting aria-modal there would wrongly tell
        // assistive tech the main content is inert.
        role={mobileNavOpen ? "dialog" : undefined}
        aria-modal={mobileNavOpen ? true : undefined}
        aria-label="Workspace navigation"
        tabIndex={-1}
        className={`workspace-sidebar border-border bg-card text-foreground fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shrink-0 -translate-x-full flex-col border-r outline-none transition-transform duration-200 md:static md:z-auto md:w-64 md:max-w-none md:translate-x-0 ${mobileNavOpen ? "translate-x-0" : ""}`}
      >
        <div className="border-border flex items-center gap-3 border-b px-3 py-3">
          <Link to="/" aria-label="Canvas home" className="shrink-0">
            <CanvasLogo size={56} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              to="/"
              className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-[10px] tracking-wide uppercase"
            >
              <ChevronLeft className="h-3 w-3" aria-hidden />
              All workspaces
            </Link>
            <h1 className="truncate text-sm font-semibold">{workspace?.name ?? "Workspace"}</h1>
          </div>
          <NotificationsBell />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Close navigation menu"
            title="Close navigation menu"
            className="md:hidden"
            onClick={() => setMobileNavOpen(false)}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="border-border space-y-2 border-b px-3 py-2.5">
          {workspaceId && <SearchBox workspaceId={workspaceId} />}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => setGenerateOpen(true)}
              aria-label="Generate image"
              title="Generate image"
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              Generate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => setBrainOpen(true)}
              aria-label="Open Brain"
              title="Open Brain"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Brain
            </Button>
          </div>
          <RunningTimerWidget />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {workspaceId && <WorkspaceNav workspaceId={workspaceId} />}
          {workspaceId && (
            <>
              <div className="border-border my-3 border-t" />
              <HierarchySidebar workspaceId={workspaceId} activeListId={listId} />
            </>
          )}
        </div>

        <div className="border-border flex items-center gap-2 border-t px-3 py-2.5">
          <Link
            to="/account"
            className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 -m-1"
            aria-label="Account settings"
            title="Account settings"
          >
            <Avatar name={user?.name ?? user?.email ?? "?"} avatarUrl={user?.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name ?? user?.email}</p>
              {membership && (
                <p className="text-muted-foreground truncate text-xs capitalize">
                  {membership.role}
                </p>
              )}
            </div>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => logOut.mutate()}
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {workspaceId && <LoginSummaryPanel workspaceId={workspaceId} />}
      {brainOpen && workspaceId && (
        <BrainChatPanel
          workspaceId={workspaceId}
          contextType="global"
          onClose={() => setBrainOpen(false)}
        />
      )}
      {generateOpen && workspaceId && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <button
            type="button"
            aria-label="Close generate panel"
            title="Close generate panel"
            className="absolute inset-0 bg-black/20"
            onClick={() => setGenerateOpen(false)}
          />
          <div
            ref={generatePanelRef}
            onKeyDown={generatePanelOnKeyDown}
            role="dialog"
            aria-modal="true"
            aria-label="Generate image"
            tabIndex={-1}
            className="border-border bg-background relative h-full w-full max-w-md overflow-y-auto border-l p-4 shadow-xl outline-none"
          >
            <GenerationPanel
              workspaceId={workspaceId}
              listId={listId}
              onClose={() => setGenerateOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
