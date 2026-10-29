import type { AppRouter } from "@canvas/api";
import {
  EMPTY_PROFILE_DRAFT,
  type EmployeeProfileDraft,
} from "@/components/employee-profile-draft";
import { EmployeeProfileFields } from "@/components/employee-profile-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { Avatar } from "@/lib/avatar";
import { trpc } from "@/lib/trpc";
import { PEOPLE_ROLE_LABELS, PEOPLE_ROLES, type PeopleRole } from "@canvas/shared";
import { createRoute, Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

type Profile = inferRouterOutputs<AppRouter>["people"]["profile"];

export const personProfileRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/people/$userId",
  component: PersonProfilePage,
});

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function PersonProfilePage() {
  const { workspaceId, userId } = personProfileRoute.useParams();
  const profile = trpc.people.profile.useQuery({ workspaceId, userId });

  if (profile.isLoading) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  if (profile.error || !profile.data) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        You don't have access to this profile, or it doesn't exist.
      </p>
    );
  }
  const p = profile.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6" data-testid="person-profile">
      <Link
        to="/w/$workspaceId/people"
        params={{ workspaceId }}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        People
      </Link>

      <div className="flex items-center gap-3">
        <Avatar name={p.name} avatarUrl={p.avatarUrl} className="h-12 w-12 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{p.name}</h1>
          <p className="text-muted-foreground truncate text-xs">{p.email}</p>
        </div>
        <span className="bg-accent-soft text-accent rounded-full px-2 py-0.5 text-xs font-medium">
          {PEOPLE_ROLE_LABELS[p.peopleRole]}
        </span>
        {p.status === "inactive" && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
            Deactivated
          </span>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="person-details">
        <Detail label="Position" value={p.jobTitle} />
        <Detail label="Department" value={p.department} />
        <Detail label="Reports to" value={p.managerName} />
        <Detail label="Employment start" value={formatDate(p.employmentStartDate)} />
        {p.personal && (
          <>
            <Detail label="Phone" value={p.personal.phone} />
            <Detail label="Address" value={p.personal.address} />
            <Detail label="Date of birth" value={formatDate(p.personal.dateOfBirth)} />
            <Detail
              label="Emergency contact"
              value={
                [p.personal.emergencyContactName, p.personal.emergencyContactPhone]
                  .filter(Boolean)
                  .join(" · ") || null
              }
            />
          </>
        )}
      </dl>

      {p.canManage && (
        <>
          <RoleAndManagerEditor workspaceId={workspaceId} profile={p} />
          <ProfileEditor workspaceId={workspaceId} profile={p} />
          <StatusEditor workspaceId={workspaceId} profile={p} />
        </>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function useInvalidatePerson() {
  const utils = trpc.useUtils();
  return async () => {
    await Promise.all([
      utils.people.profile.invalidate(),
      utils.people.directory.invalidate(),
      utils.workspace.members.invalidate(),
    ]);
  };
}

function RoleAndManagerEditor({ workspaceId, profile }: { workspaceId: string; profile: Profile }) {
  const invalidate = useInvalidatePerson();
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const setRole = trpc.people.setRole.useMutation({ onSuccess: invalidate });
  const setManager = trpc.people.setManager.useMutation({ onSuccess: invalidate });
  const error = setRole.error ?? setManager.error;

  const roles = PEOPLE_ROLES.filter(
    (r) => r !== "super_admin" || profile.canAssignSuperAdmin || profile.peopleRole === r,
  );

  return (
    <section
      className="border-border space-y-3 rounded-md border p-4"
      data-testid="person-role-editor"
    >
      <h2 className="text-sm font-semibold">Role & reporting</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="person-role" className="text-xs">
            Role
          </Label>
          <select
            id="person-role"
            value={profile.peopleRole}
            disabled={profile.isOwner || setRole.isPending}
            onChange={(e) =>
              setRole.mutate({
                workspaceId,
                userId: profile.userId,
                peopleRole: e.target.value as PeopleRole,
              })
            }
            className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {PEOPLE_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {profile.isOwner && (
            <p className="text-muted-foreground text-xs">
              The workspace owner is always a super admin.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="person-manager" className="text-xs">
            Reports to
          </Label>
          <select
            id="person-manager"
            value={profile.managerUserId ?? ""}
            disabled={setManager.isPending}
            onChange={(e) =>
              setManager.mutate({
                workspaceId,
                userId: profile.userId,
                managerUserId: e.target.value || null,
              })
            }
            className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="">Nobody</option>
            {(members.data ?? [])
              .filter((m) => m.userId !== profile.userId)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error.message}
        </p>
      )}
    </section>
  );
}

function ProfileEditor({ workspaceId, profile }: { workspaceId: string; profile: Profile }) {
  const invalidate = useInvalidatePerson();
  const initial: EmployeeProfileDraft = {
    ...EMPTY_PROFILE_DRAFT,
    jobTitle: profile.jobTitle ?? "",
    department: profile.department ?? "",
    employmentStartDate: profile.employmentStartDate ?? "",
    phone: profile.personal?.phone ?? "",
    address: profile.personal?.address ?? "",
    dateOfBirth: profile.personal?.dateOfBirth ?? "",
    emergencyContactName: profile.personal?.emergencyContactName ?? "",
    emergencyContactPhone: profile.personal?.emergencyContactPhone ?? "",
  };
  const [draft, setDraft] = useState(initial);
  const update = trpc.people.updateProfile.useMutation({ onSuccess: invalidate });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ workspaceId, userId: profile.userId, ...draft });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border space-y-3 rounded-md border p-4"
      data-testid="person-profile-editor"
    >
      <h2 className="text-sm font-semibold">Edit profile</h2>
      <EmployeeProfileFields draft={draft} onChange={setDraft} idPrefix="profile" />
      {update.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {update.error.message}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save profile"}
        </Button>
        {update.isSuccess && !update.isPending && (
          <span className="text-muted-foreground text-xs">Saved</span>
        )}
      </div>
    </form>
  );
}

function StatusEditor({ workspaceId, profile }: { workspaceId: string; profile: Profile }) {
  const { user } = useSession();
  const invalidate = useInvalidatePerson();
  const setStatus = trpc.people.setStatus.useMutation({ onSuccess: invalidate });
  if (profile.isOwner || profile.userId === user?.id) return null;

  const inactive = profile.status === "inactive";
  return (
    <section className="border-border space-y-2 rounded-md border p-4">
      <h2 className="text-sm font-semibold">{inactive ? "Reactivate" : "Deactivate"}</h2>
      <p className="text-muted-foreground text-xs">
        {inactive
          ? "Gives them access to this workspace again, exactly as before."
          : "They can no longer open this workspace and disappear from member pickers. Their tasks, comments and history stay."}
      </p>
      {setStatus.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {setStatus.error.message}
        </p>
      )}
      <Button
        size="sm"
        variant={inactive ? "default" : "outline"}
        disabled={setStatus.isPending}
        onClick={() =>
          setStatus.mutate({
            workspaceId,
            userId: profile.userId,
            status: inactive ? "active" : "inactive",
          })
        }
        data-testid="person-status-toggle"
      >
        {inactive ? "Reactivate" : "Deactivate"}
      </Button>
    </section>
  );
}
