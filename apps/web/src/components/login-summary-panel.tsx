import { TaskHighlightRow } from "@/components/task-highlight-row";
import { Button } from "@/components/ui/button";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import { Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// Set by login.tsx/signup.tsx right before navigating away, so this only
// ever fires once per real login — not on every WorkspaceShell mount
// (switching workspaces, reloading the page, etc).
export const JUST_LOGGED_IN_KEY = "canvas:justLoggedIn";

export function LoginSummaryPanel({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const { containerRef, onKeyDown } = useModalA11y(() => setOpen(false), open);

  useEffect(() => {
    if (sessionStorage.getItem(JUST_LOGGED_IN_KEY)) {
      sessionStorage.removeItem(JUST_LOGGED_IN_KEY);
      setOpen(true);
    }
  }, []);

  const highlights = trpc.task.highlights.useQuery({ workspaceId }, { enabled: open });
  const members = trpc.workspace.members.useQuery({ workspaceId }, { enabled: open });
  const memberNamesById = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.userId, m.name])),
    [members.data],
  );

  const priorityTasks = highlights.data?.priority ?? [];
  if (!open || (highlights.isFetched && priorityTasks.length === 0)) return null;

  return (
    <div data-testid="login-summary-panel" className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Close summary"
        title="Close summary"
        className="absolute inset-0 bg-black/20"
        onClick={() => setOpen(false)}
      />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome back summary"
        tabIndex={-1}
        className="border-border bg-background relative flex h-full w-full max-w-md flex-col border-l shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="bg-accent-soft text-accent flex h-8 w-8 items-center justify-center rounded-md">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">Welcome back</h2>
              <p className="text-muted-foreground text-xs">Urgent and assigned to you</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            aria-label="Close"
            title="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
          {priorityTasks.map((task) => (
            <TaskHighlightRow
              key={task.id}
              task={task}
              workspaceId={workspaceId}
              memberNamesById={memberNamesById}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
