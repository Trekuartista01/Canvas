import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ClipboardList,
  Clock3,
  FileText,
  Gauge,
  Home,
  Images,
  LayoutGrid,
  Palette,
  PenSquare,
  Sparkles,
  UserCog,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

type NavEntry = { label: string; to: string; icon: LucideIcon };

const NAV_GROUPS: { label: string; entries: NavEntry[] }[] = [
  {
    label: "Work",
    entries: [
      { label: "Home", to: "/w/$workspaceId", icon: Home },
      { label: "Dashboards", to: "/w/$workspaceId/dashboards", icon: LayoutGrid },
      { label: "Workload", to: "/w/$workspaceId/workload", icon: Users },
      { label: "Timesheet", to: "/w/$workspaceId/timesheet", icon: Clock3 },
      { label: "Automations", to: "/w/$workspaceId/automations", icon: Zap },
      { label: "Smart Search", to: "/w/$workspaceId/semantic-search", icon: Sparkles },
    ],
  },
  {
    label: "Collaborate",
    entries: [
      { label: "Docs", to: "/w/$workspaceId/docs", icon: FileText },
      { label: "Forms", to: "/w/$workspaceId/forms", icon: ClipboardList },
      { label: "Brand Kits", to: "/w/$workspaceId/brand-kits", icon: Palette },
      { label: "Library", to: "/w/$workspaceId/library", icon: Images },
      { label: "Copywriter", to: "/w/$workspaceId/copywriter", icon: PenSquare },
    ],
  },
  {
    label: "Platform",
    entries: [
      { label: "Admin", to: "/w/$workspaceId/admin", icon: Gauge },
      { label: "Roles", to: "/w/$workspaceId/roles", icon: UserCog },
    ],
  },
];

export function WorkspaceNav({ workspaceId }: { workspaceId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const base = `/w/${workspaceId}`;

  // Reuses WorkspaceShell's already-fetched `listMine` cache entry (same
  // query key, no args) — no extra network request from calling it again
  // here.
  const workspaces = trpc.workspace.listMine.useQuery();
  const myRole = workspaces.data?.find((w) => w.workspace.id === workspaceId)?.role;
  // Platform (Admin, Roles) — owner/admin only.
  // Regular members and guests never see this group.
  const canSeePlatform = myRole === "owner" || myRole === "admin";

  function isActive(to: string) {
    const target = to.replace("$workspaceId", workspaceId);
    if (target === base) return pathname === base;
    return pathname === target || pathname.startsWith(`${target}/`);
  }

  const visibleGroups = NAV_GROUPS.filter((group) => group.label !== "Platform" || canSeePlatform);

  return (
    <nav className="flex flex-col gap-4">
      {visibleGroups.map((group) => (
        <div key={group.label}>
          <p className="text-muted-foreground px-2 pb-1 text-[10px] font-semibold tracking-wide uppercase">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.entries.map((entry) => {
              const active = isActive(entry.to);
              const Icon = entry.icon;
              return (
                <Link
                  key={entry.to}
                  to={entry.to}
                  params={{ workspaceId }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent-soft text-accent font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{entry.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
