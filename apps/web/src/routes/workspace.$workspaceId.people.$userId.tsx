import {
  EMPTY_PROFILE_DRAFT,
  type EmployeeProfileDraft,
} from "@/components/employee-profile-draft";
import { EmployeeProfileFields } from "@/components/employee-profile-fields";
import {
  Detail,
  formatDate,
  MyDetailsEditor,
  ResetMyPassword,
  type PersonProfile,
} from "@/components/my-profile";
import { ConfidentialPanel } from "@/components/person-confidential";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { Avatar } from "@/lib/avatar";
import { trpc } from "@/lib/trpc";
import { PEOPLE_ROLE_LABELS, PEOPLE_ROLES, type PeopleRole } from "@canvas/shared";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

type Profile = PersonProfile;

export const personProfileRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/people/$userId",
  component: PersonProfilePage,
});

function PersonProfilePage() {
  const { workspaceId, userId } = personProfileRoute.useParams();
  const profile = trpc.people.profile.useQuery(
    { workspaceId, userId },
    // A refusal or an archived/deleted person won't change on retry.
    { retry: (count, err) => (err.data?.httpStatus ?? 500) >= 500 && count < 3 },
  );
  const [tab, setTab] = useState<"profile" | "confidential">("profile");

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
          <h1 className="truncate text-2xl font-bold tracking-tight">{p.name}</h1>
          <p className="text-muted-foreground truncate text-xs">{p.email}</p>
        </div>
        <span className="bg-accent-soft text-accent rounded-full px-2 py-0.5 text-xs font-medium">
          {PEOPLE_ROLE_LABELS[p.peopleRole]}
        </span>
        {p.status === "inactive" && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600 dark:text-red-400">
            Archived
          </span>
        )}
      </div>

      {p.canManage && (
        <div className="flex gap-1" role="tablist">
          {(["profile", "confidential"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              role="tab"
              aria-selected={tab === t}
              variant={tab === t ? "default" : "ghost"}
              onClick={() => setTab(t)}
            >
              {t === "profile" ? "Profile" : "Confidential"}
            </Button>
          ))}
        </div>
      )}

      {tab === "confidential" && p.canManage ? (
        <ConfidentialPanel workspaceId={workspaceId} profile={p} />
      ) : (
        <ProfileTab workspaceId={workspaceId} profile={p} />
      )}
    </div>
  );
}

function ProfileTab({ workspaceId, profile: p }: { workspaceId: string; profile: Profile }) {
  const { user } = useSession();
  return (
    <>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="person-details">
        <Detail label="Position" value={p.jobTitle} />
        <Detail label="Department" value={p.department} />
        <Detail label="Reports to" value={p.managerName} />
        {p.personal && (
          <>
            <Detail label="Employment start" value={formatDate(p.employmentStartDate)} />
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

      {(p.canManage || p.canAssignRoles) && (
        <RoleAndManagerEditor workspaceId={workspaceId} profile={p} />
      )}
      {p.canManage && (
        <>
          <ProfileEditor workspaceId={workspaceId} profile={p} />
          <ArchiveEditor workspaceId={workspaceId} profile={p} />
        </>
      )}
      {user?.id === p.userId && (
        <>
          {!p.canManage && <MyDetailsEditor workspaceId={workspaceId} profile={p} />}
          <ResetMyPassword email={p.email} />
        </>
      )}
    </>
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

// Role: admin only (roles:assign), and never HR for themselves. Reports to:
// HR (people:manageStaff). The server enforces both.
function RoleAndManagerEditor({ workspaceId, profile }: { workspaceId: string; profile: Profile }) {
  const invalidate = useInvalidatePerson();
  const { user } = useSession();
  const members = trpc.workspace.members.useQuery({ workspaceId });
  const setRole = trpc.people.setRole.useMutation({ onSuccess: invalidate });
  const setManager = trpc.people.setManager.useMutation({ onSuccess: invalidate });
  const error = setRole.error ?? setManager.error;

  const roles = PEOPLE_ROLES.filter(
    (r) => r !== "hr_finance" || profile.userId !== user?.id || profile.peopleRole === r,
  );

  return (
    <section
      className="bg-card shadow-sm border-border space-y-3 rounded-md border p-4"
      data-testid="person-role-editor"
    >
      <h2 className="text-base font-semibold">Role & reporting</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {profile.canAssignRoles && (
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
                The workspace owner is always an admin.
              </p>
            )}
          </div>
        )}
        {profile.canManage && (
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
        )}
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
      <h2 className="text-base font-semibold">Edit profile</h2>
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

// P8.3 "Remove" = archive: gone from lists and logins, records kept. Only an
// archived person can be deleted permanently (HR; the server checks both).
function ArchiveEditor({ workspaceId, profile }: { workspaceId: string; profile: Profile }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const invalidate = useInvalidatePerson();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archive = trpc.people.archive.useMutation({ onSuccess: invalidate });
  const unarchive = trpc.people.unarchive.useMutation({ onSuccess: invalidate });
  const remove = trpc.people.deletePermanently.useMutation({
    onSuccess: async () => {
      await invalidate();
      await navigate({ to: "/w/$workspaceId/people", params: { workspaceId } });
    },
  });
  if (profile.isOwner || profile.userId === user?.id) return null;

  const archived = profile.status === "inactive";
  const error = archive.error ?? unarchive.error ?? remove.error;
  const busy = archive.isPending || unarchive.isPending || remove.isPending;
  const target = { workspaceId, userId: profile.userId };

  return (
    <section
      className="bg-card shadow-sm border-border space-y-2 rounded-md border p-4"
      data-testid="person-archive"
    >
      <h2 className="text-base font-semibold">{archived ? "Archived" : "Remove"}</h2>
      <p className="text-muted-foreground text-xs">
        {archived
          ? "They can't open this workspace and don't appear in lists. Their contracts, payroll and leave history are kept."
          : "Archives them: they can no longer open this workspace and disappear from lists. Contracts, payroll and leave history stay for the records."}
      </p>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {archived ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => unarchive.mutate(target)}
            data-testid="person-unarchive"
          >
            Restore
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => archive.mutate(target)}
            data-testid="person-archive-button"
          >
            Remove (archive)
          </Button>
        )}
        {archived &&
          (confirmDelete ? (
            <>
              <span className="text-xs text-red-600 dark:text-red-400">
                Deletes their payroll, contracts, leave and files for good.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/50 text-red-600 dark:text-red-400"
                disabled={busy}
                onClick={() => remove.mutate(target)}
                data-testid="person-delete-confirm"
              >
                Yes, delete permanently
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600 dark:text-red-400"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              data-testid="person-delete"
            >
              Delete permanently…
            </Button>
          ))}
      </div>
    </section>
  );
}
