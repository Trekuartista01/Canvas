import { useMyAccess } from "@/hooks/use-my-access";
import { cn } from "@/lib/utils";
import type { PeopleAction, WorkspaceAction } from "@canvas/shared";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Banknote,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Contact,
  FileSignature,
  FileText,
  FolderOpen,
  Gauge,
  Home,
  Images,
  LayoutGrid,
  NotebookPen,
  Palette,
  Plane,
  PenSquare,
  Sparkles,
  UserCog,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

// `requires`: shown only when people.myAccess grants that action (M7.1 —
// each role only sees the sections it can use). No `requires` = everyone.
type NavEntry = {
  label: string;
  to: string;
  icon: LucideIcon;
  requires?: WorkspaceAction | PeopleAction;
};

const NAV_GROUPS: { label: string; entries: NavEntry[] }[] = [
  {
    label: "Work",
    entries: [
      // Home is the team task view managers land on; staff land on My Tasks.
      { label: "Home", to: "/w/$workspaceId", icon: Home, requires: "report:viewTeam" },
      { label: "My Tasks", to: "/w/$workspaceId/my-tasks", icon: CheckSquare },
      {
        label: "Dashboards",
        to: "/w/$workspaceId/dashboards",
        icon: LayoutGrid,
        requires: "dashboard:view",
      },
      {
        label: "Workload",
        to: "/w/$workspaceId/workload",
        icon: Users,
        requires: "report:viewTeam",
      },
      { label: "Timesheet", to: "/w/$workspaceId/timesheet", icon: Clock3 },
      {
        label: "Automations",
        to: "/w/$workspaceId/automations",
        icon: Zap,
        requires: "automation:view",
      },
      {
        label: "Smart Search",
        to: "/w/$workspaceId/semantic-search",
        icon: Sparkles,
        requires: "task:view",
      },
    ],
  },
  {
    label: "People",
    entries: [
      {
        label: "Directory",
        to: "/w/$workspaceId/people",
        icon: Contact,
        requires: "people:viewDirectory",
      },
      // M7.3: everyone writes their own; managers see their team's.
      { label: "Daily report", to: "/w/$workspaceId/daily-report", icon: NotebookPen },
      {
        label: "Team reports",
        to: "/w/$workspaceId/team-reports",
        icon: ClipboardCheck,
        requires: "report:viewTeam",
      },
      // M7.4: everyone sees the calendar; HR edits it there.
      { label: "Holidays", to: "/w/$workspaceId/holidays", icon: CalendarDays },
      // M7.5 leave.
      { label: "Leave", to: "/w/$workspaceId/leave", icon: Plane },
      {
        label: "Leave approvals",
        to: "/w/$workspaceId/leave-approvals",
        icon: ClipboardCheck,
        requires: "leave:approve",
      },
      { label: "Who's off", to: "/w/$workspaceId/whos-off", icon: CalendarRange },
      // M7.6: own contract for everyone, every contract for HR, shared library.
      { label: "My contract", to: "/w/$workspaceId/my-contract", icon: FileSignature },
      {
        label: "Contracts",
        to: "/w/$workspaceId/contracts",
        icon: FileSignature,
        requires: "contract:manage",
      },
      { label: "Company documents", to: "/w/$workspaceId/company-documents", icon: FolderOpen },
      // M7.7: own pay details for everyone; the payroll table for HR only.
      { label: "My pay details", to: "/w/$workspaceId/my-pay", icon: Wallet },
      {
        label: "Payroll",
        to: "/w/$workspaceId/payroll",
        icon: Banknote,
        requires: "payroll:view",
      },
    ],
  },
  {
    label: "Collaborate",
    entries: [
      { label: "Docs", to: "/w/$workspaceId/docs", icon: FileText, requires: "doc:view" },
      { label: "Forms", to: "/w/$workspaceId/forms", icon: ClipboardList, requires: "form:view" },
      {
        label: "Brand Kits",
        to: "/w/$workspaceId/brand-kits",
        icon: Palette,
        requires: "brandSettings:view",
      },
      {
        label: "Library",
        to: "/w/$workspaceId/library",
        icon: Images,
        requires: "imageAsset:view",
      },
      {
        label: "Copywriter",
        to: "/w/$workspaceId/copywriter",
        icon: PenSquare,
        requires: "copyGeneration:create",
      },
    ],
  },
  {
    label: "Platform",
    entries: [
      { label: "Admin", to: "/w/$workspaceId/admin", icon: Gauge, requires: "workspace:manage" },
      { label: "Roles", to: "/w/$workspaceId/roles", icon: UserCog, requires: "customRole:view" },
    ],
  },
];

export function WorkspaceNav({ workspaceId }: { workspaceId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const base = `/w/${workspaceId}`;
  const access = useMyAccess(workspaceId);

  function isActive(to: string) {
    const target = to.replace("$workspaceId", workspaceId);
    if (target === base) return pathname === base;
    return pathname === target || pathname.startsWith(`${target}/`);
  }

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => !entry.requires || access.can(entry.requires)),
  })).filter((group) => group.entries.length > 0);

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
