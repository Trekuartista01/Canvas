import { Detail, formatDate, MyDetailsEditor, ResetMyPassword } from "@/components/my-profile";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { Avatar } from "@/lib/avatar";
import { trpc } from "@/lib/trpc";
import { PEOPLE_ROLE_LABELS } from "@canvas/shared";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { Camera, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { rootRoute } from "./__root";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// Deliberately a top-level route, not nested under a workspace — account
// deletion is per-user, not per-workspace, and a user with zero workspace
// memberships (e.g. right after signup, or after leaving their last one)
// still needs to be able to reach it. See auth.deleteAccount for the
// sole-owner guard this page's error message reflects.
export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: () => (
    <RequireAuth>
      <AccountPage />
    </RequireAuth>
  ),
});

function AccountPage() {
  const { user, refetch } = useSession();
  const navigate = useNavigate();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirming, setConfirming] = useState(false);

  const deleteAccount = trpc.auth.deleteAccount.useMutation({
    onSuccess: () => navigate({ to: "/login" }),
  });

  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saved, setSaved] = useState(false);
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: async () => {
      await refetch();
      setSaved(true);
    },
  });

  useEffect(() => {
    setName(user?.name ?? "");
    setBio(user?.bio ?? "");
  }, [user?.name, user?.bio]);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    if (!file.type.startsWith("image/") || file.type.toLowerCase() === "image/svg+xml") {
      setAvatarError("File must be an image");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Image must be under 5MB");
      return;
    }

    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/avatars", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Upload failed");
      }
      await refetch();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  if (!user) return null;

  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col gap-6 px-4 py-16">
      <div className="flex items-center gap-2">
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← Back
        </Link>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <Avatar name={user.name} avatarUrl={user.avatarUrl} className="h-16 w-16 text-lg" />
            <button
              type="button"
              aria-label="Change photo"
              title="Change photo"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="bg-accent text-accent-foreground absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full shadow"
            >
              <Camera className="h-3 w-3" aria-hidden />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="profile-avatar-file"
              onChange={(e) => void handleAvatarFile(e.target.files?.[0])}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{user.name}</h1>
            <p className="text-muted-foreground truncate text-sm">{user.email}</p>
          </div>
        </div>
        {avatarUploading && <p className="text-muted-foreground mt-2 text-xs">Uploading…</p>}
        {avatarError && <p className="text-status-critical mt-2 text-xs">{avatarError}</p>}

        <form
          className="border-border mt-4 space-y-3 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            updateProfile.mutate({ name, bio });
          }}
        >
          <div className="space-y-1">
            <label htmlFor="profile-name" className="text-xs font-medium">
              Name
            </label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="profile-name-input"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="profile-bio" className="text-xs font-medium">
              Bio
            </label>
            <Textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              data-testid="profile-bio-input"
            />
          </div>

          {updateProfile.error && (
            <p className="text-status-critical text-xs">{updateProfile.error.message}</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={updateProfile.isPending || !name.trim()}
              data-testid="profile-save"
            >
              {updateProfile.isPending ? "Saving…" : "Save"}
            </Button>
            {saved && !updateProfile.isPending && (
              <span className="text-muted-foreground text-xs">Saved</span>
            )}
          </div>
        </form>
      </Card>

      <WorkProfiles userId={user.id} />

      <ResetMyPassword email={user.email} />

      <Card className="border-status-critical/30 p-4" data-testid="danger-zone-section">
        <CardHeader className="p-0 pb-3">
          <div className="flex items-center gap-2">
            <TriangleAlert className="text-status-critical h-4 w-4" aria-hidden />
            <CardTitle className="text-sm">Danger zone</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          <p className="text-muted-foreground text-xs">
            Delete your account — this removes your personal data (login, saved sessions) and your
            membership in every workspace. Content you created stays where the rest of the app
            already keeps content after its author is gone. This cannot be undone.
          </p>

          {!confirming ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-status-critical"
              onClick={() => setConfirming(true)}
              data-testid="delete-account-start"
            >
              Delete my account
            </Button>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                deleteAccount.mutate({ confirmEmail });
              }}
            >
              <label htmlFor="delete-account-confirm" className="text-xs font-medium">
                Type your email ({user.email}) to confirm
              </label>
              <Input
                id="delete-account-confirm"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={user.email}
                data-testid="delete-account-confirm-email"
              />
              {deleteAccount.error && (
                <p className="text-status-critical text-xs">{deleteAccount.error.message}</p>
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="text-status-critical"
                  disabled={
                    deleteAccount.isPending ||
                    confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()
                  }
                  data-testid="delete-account-confirm"
                >
                  {deleteAccount.isPending ? "Deleting…" : "Permanently delete my account"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirming(false);
                    setConfirmEmail("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

// These details belong to a person's place in a workspace, not to their login,
// so someone in two workspaces has a set for each.
function WorkProfiles({ userId }: { userId: string }) {
  const workspaces = trpc.workspace.listMine.useQuery();
  return (
    <>
      {workspaces.data?.map(({ workspace }) => (
        <WorkProfile
          key={workspace.id}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          userId={userId}
        />
      ))}
    </>
  );
}

function WorkProfile({
  workspaceId,
  workspaceName,
  userId,
}: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
}) {
  const profile = trpc.people.profile.useQuery({ workspaceId, userId });
  const p = profile.data;

  return (
    <Card className="space-y-4 p-4" data-testid="work-profile">
      <div>
        <h2 className="text-sm font-semibold">Your profile in {workspaceName}</h2>
        <p className="text-muted-foreground text-xs">HR keeps the details that aren't editable.</p>
      </div>
      {profile.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {profile.error && (
        <p className="text-status-critical text-xs" role="alert">
          We couldn't load this profile. Refresh the page to try again.
        </p>
      )}
      {p && (
        <>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Detail label="Role" value={PEOPLE_ROLE_LABELS[p.peopleRole]} />
            <Detail label="Reports to" value={p.managerName} />
            <Detail label="Employment start" value={formatDate(p.employmentStartDate)} />
          </dl>
          <MyDetailsEditor workspaceId={workspaceId} profile={p} />
        </>
      )}
    </Card>
  );
}
