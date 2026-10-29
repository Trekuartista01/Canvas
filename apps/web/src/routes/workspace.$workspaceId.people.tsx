import {
  EMPTY_PROFILE_DRAFT,
  type EmployeeProfileDraft,
} from "@/components/employee-profile-draft";
import { EmployeeProfileFields } from "@/components/employee-profile-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyAccess } from "@/hooks/use-my-access";
import { Avatar } from "@/lib/avatar";
import { trpc } from "@/lib/trpc";
import { PEOPLE_ROLE_LABELS, PEOPLE_ROLES, type PeopleRole } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute, Link, Navigate } from "@tanstack/react-router";
import { Contact, UserPlus } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const peopleDirectoryRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/people",
  component: PeopleDirectoryPage,
});

function PeopleDirectoryPage() {
  const { workspaceId } = peopleDirectoryRoute.useParams();
  const access = useMyAccess(workspaceId);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const allowed = access.can("people:viewDirectory");
  const directory = trpc.people.directory.useQuery(
    { workspaceId, includeInactive },
    { enabled: allowed },
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = directory.data ?? [];
    if (!needle) return all;
    return all.filter((p) =>
      [p.name, p.email, p.jobTitle, p.department, p.managerName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [directory.data, search]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  if (access.isLoading) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  // Staff have no directory (they still reach their own profile from My
  // Tasks' header). The API enforces this regardless.
  if (!allowed) return <Navigate to="/w/$workspaceId/my-tasks" params={{ workspaceId }} replace />;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 p-6" data-testid="people-page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Contact className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">People</h1>
          <p className="text-muted-foreground text-xs">Everyone in this workspace.</p>
        </div>
        {access.can("people:manageStaff") && !adding && (
          <Button size="sm" onClick={() => setAdding(true)} data-testid="people-add-staff">
            <UserPlus className="h-4 w-4" aria-hidden />
            Add staff
          </Button>
        )}
      </div>

      {adding && (
        <AddStaffForm
          workspaceId={workspaceId}
          canAssignSuperAdmin={access.can("people:assignSuperAdmin")}
          onDone={() => setAdding(false)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search name, email, position…"
          aria-label="Search people"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs text-xs"
          data-testid="people-search"
        />
        <select
          aria-label="Show"
          value={includeInactive ? "all" : "active"}
          onChange={(e) => setIncludeInactive(e.target.value === "all")}
          className="border-border bg-background h-8 rounded border text-xs"
          data-testid="people-status-filter"
        >
          <option value="active">Active only</option>
          <option value="all">Active and deactivated</option>
        </select>
        <span className="text-muted-foreground text-xs">{rows.length} people</span>
      </div>

      {directory.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nobody matches.</p>
      ) : (
        <div
          ref={parentRef}
          className="border-border min-h-0 flex-1 overflow-auto rounded-md border"
          data-testid="people-list"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const person = rows[item.index]!;
              return (
                <Link
                  key={person.userId}
                  to="/w/$workspaceId/people/$userId"
                  params={{ workspaceId, userId: person.userId }}
                  className="hover:bg-muted absolute right-0 left-0 flex items-center gap-3 border-b px-3"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  data-testid={`person-row-${person.email}`}
                >
                  <Avatar name={person.name} avatarUrl={person.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{person.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {[person.jobTitle, person.department].filter(Boolean).join(" · ") ||
                        person.email}
                    </span>
                  </span>
                  <span className="text-muted-foreground hidden shrink-0 text-xs sm:block">
                    {person.managerName ? `Reports to ${person.managerName}` : ""}
                  </span>
                  <span className="bg-muted shrink-0 rounded-full px-2 py-0.5 text-[11px]">
                    {PEOPLE_ROLE_LABELS[person.peopleRole]}
                  </span>
                  {person.status === "inactive" && (
                    <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] text-red-600 dark:text-red-400">
                      Deactivated
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AddStaffForm({
  workspaceId,
  canAssignSuperAdmin,
  onDone,
}: {
  workspaceId: string;
  canAssignSuperAdmin: boolean;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [peopleRole, setPeopleRole] = useState<PeopleRole>("staff");
  const [managerUserId, setManagerUserId] = useState("");
  const [draft, setDraft] = useState<EmployeeProfileDraft>(EMPTY_PROFILE_DRAFT);

  const create = trpc.people.createStaff.useMutation({
    onSuccess: async () => {
      await utils.people.directory.invalidate();
      await utils.workspace.members.invalidate();
      onDone();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate({
      workspaceId,
      name,
      email,
      password,
      peopleRole,
      managerUserId: managerUserId || null,
      ...draft,
    });
  }

  const roles = PEOPLE_ROLES.filter((r) => r !== "super_admin" || canAssignSuperAdmin);

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border space-y-4 rounded-md border p-4"
      data-testid="add-staff-form"
    >
      <div>
        <h2 className="text-sm font-semibold">Add staff</h2>
        <p className="text-muted-foreground text-xs">
          Creates their account. Share the email and initial password with them — they sign in with
          it right away. Someone who already has an account should be invited instead.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="staff-name" className="text-xs">
            Full name
          </Label>
          <Input id="staff-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="staff-email" className="text-xs">
            Email
          </Label>
          <Input
            id="staff-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="staff-password" className="text-xs">
            Initial password
          </Label>
          <Input
            id="staff-password"
            type="text"
            required
            minLength={8}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="staff-role" className="text-xs">
            Role
          </Label>
          <select
            id="staff-role"
            value={peopleRole}
            onChange={(e) => setPeopleRole(e.target.value as PeopleRole)}
            className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {PEOPLE_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="staff-manager" className="text-xs">
            Reports to
          </Label>
          <select
            id="staff-manager"
            value={managerUserId}
            onChange={(e) => setManagerUserId(e.target.value)}
            className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="">Nobody</option>
            {(members.data ?? []).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <EmployeeProfileFields draft={draft} onChange={setDraft} idPrefix="staff" />
      {create.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {create.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending} data-testid="add-staff-submit">
          {create.isPending ? "Creating…" : "Create account"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
