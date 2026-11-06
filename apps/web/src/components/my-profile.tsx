import type { AppRouter } from "@canvas/api";
import { DepartmentSelect } from "@/components/department-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { useId, useState } from "react";

export type PersonProfile = inferRouterOutputs<AppRouter>["people"]["profile"];

export function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

/** The details someone keeps up to date themselves, in one workspace. */
export function MyDetailsEditor({
  workspaceId,
  profile,
}: {
  workspaceId: string;
  profile: PersonProfile;
}) {
  const utils = trpc.useUtils();
  // Account shows one of these per workspace, so the ids can't be fixed.
  const fieldId = useId();
  const [jobTitle, setJobTitle] = useState(profile.jobTitle ?? "");
  const [department, setDepartment] = useState(profile.department ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(profile.personal?.dateOfBirth ?? "");
  const [phone, setPhone] = useState(profile.personal?.phone ?? "");
  const [address, setAddress] = useState(profile.personal?.address ?? "");
  const [emergencyContactName, setEmergencyContactName] = useState(
    profile.personal?.emergencyContactName ?? "",
  );
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    profile.personal?.emergencyContactPhone ?? "",
  );
  const update = trpc.people.updateMyProfile.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.people.profile.invalidate(),
        utils.people.directory.invalidate(),
        utils.workspace.members.invalidate(),
      ]),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({
          workspaceId,
          jobTitle,
          department,
          dateOfBirth,
          phone,
          address,
          emergencyContactName,
          emergencyContactPhone,
        });
      }}
      className="border-border space-y-3 rounded-md border p-4"
      data-testid="my-details-editor"
    >
      <div>
        <h2 className="text-base font-semibold">My details</h2>
        <p className="text-muted-foreground text-xs">
          Everyone can see your position and department. Only you and HR can see the rest.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-position`} className="text-xs">
            Position
          </Label>
          <Input
            id={`${fieldId}-position`}
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-department`} className="text-xs">
            Department
          </Label>
          <DepartmentSelect
            id={`${fieldId}-department`}
            value={department}
            onChange={setDepartment}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-birthday`} className="text-xs">
            Birthday
          </Label>
          <Input
            id={`${fieldId}-birthday`}
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-phone`} className="text-xs">
            Phone
          </Label>
          <Input
            id={`${fieldId}-phone`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${fieldId}-address`} className="text-xs">
            Address
          </Label>
          <Input
            id={`${fieldId}-address`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-emergency-name`} className="text-xs">
            Emergency contact name
          </Label>
          <Input
            id={`${fieldId}-emergency-name`}
            value={emergencyContactName}
            onChange={(e) => setEmergencyContactName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-emergency-phone`} className="text-xs">
            Emergency contact phone
          </Label>
          <Input
            id={`${fieldId}-emergency-phone`}
            type="tel"
            value={emergencyContactPhone}
            onChange={(e) => setEmergencyContactPhone(e.target.value)}
          />
        </div>
      </div>
      {update.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {update.error.message}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save my details"}
        </Button>
        {update.isSuccess && !update.isPending && (
          <span className="text-muted-foreground text-xs">Saved</span>
        )}
      </div>
    </form>
  );
}

/** Emails the same link as "Forgot password", to their own address. */
export function ResetMyPassword({ email }: { email: string }) {
  const reset = trpc.auth.requestPasswordReset.useMutation();
  return (
    <div
      className="bg-card shadow-sm border-border space-y-2 rounded-md border p-4"
      data-testid="reset-my-password"
    >
      <h2 className="text-base font-semibold">Password</h2>
      <p className="text-muted-foreground text-xs">
        We'll email {email} a link to choose a new password. Changing it logs you out everywhere.
      </p>
      {reset.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {reset.error.message}
        </p>
      )}
      {reset.isSuccess ? (
        <p className="text-sm" role="status">
          Check your email for the link. It works for 1 hour, and may land in Junk.
        </p>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reset.isPending}
          onClick={() => reset.mutate({ email })}
        >
          {reset.isPending ? "Sending…" : "Email me a reset link"}
        </Button>
      )}
    </div>
  );
}
