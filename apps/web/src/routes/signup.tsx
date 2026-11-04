import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { CanvasLogo } from "@/components/canvas-logo";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { RoleRequestSelect, type RoleChoice } from "@/components/role-request";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { rootRoute } from "./__root";

const signupSearchSchema = z.object({
  invite: z.string().uuid().optional(),
});

export const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  validateSearch: signupSearchSchema,
  component: SignupPage,
});

function SignupPage() {
  const { invite: inviteId } = signupRoute.useSearch();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const invite = trpc.workspace.getInvite.useQuery(
    { inviteId: inviteId! },
    { enabled: !!inviteId },
  );

  const [name, setName] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [requestedRole, setRequestedRole] = useState<RoleChoice>("");
  const [error, setError] = useState<string | null>(null);

  const email = invite.data?.email ?? emailInput;

  const signUp = trpc.auth.signUp.useMutation({
    onSuccess: async () => {
      // See login.tsx's identical fix: refetchType: "all" is required so
      // this actually awaits the refetch — plain invalidate() only forces
      // an immediate refetch for queries with an active observer, and
      // nothing observes auth.me from this page, so RequireAuth would
      // otherwise read the stale pre-signup cache on its first render and
      // bounce back to /login before the real refetch resolves.
      await utils.auth.me.invalidate(undefined, { refetchType: "all" });
      navigate({ to: "/" });
    },
    onError: (err) => setError(err.message),
  });

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4">
      <Card className="w-full max-w-sm space-y-6 p-6">
        <div className="flex items-center gap-3">
          <CanvasLogo size={64} />
          <div>
            <h1 className="text-xl font-semibold">Create your account</h1>
            {invite.data ? (
              <p className="text-muted-foreground mt-1 text-sm">
                You've been invited to join <strong>{invite.data.workspaceName}</strong>
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">Canvas</p>
            )}
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            signUp.mutate({
              name,
              email,
              password,
              inviteId,
              // Only someone joining a workspace has anyone to ask.
              ...(inviteId && requestedRole ? { requestedRole } : {}),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmailInput(e.target.value)}
              readOnly={!!invite.data}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {inviteId && <RoleRequestSelect value={requestedRole} onChange={setRequestedRole} />}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={signUp.isPending}>
            {signUp.isPending ? "Creating account…" : "Sign up"}
          </Button>
        </form>

        <a href="/auth/google" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
          Continue with Google
        </a>

        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{" "}
          <Link to="/login" className="text-foreground underline">
            Log in
          </Link>
        </p>

        <p className="text-muted-foreground text-center text-xs">
          By signing up, you agree to the{" "}
          <Link to="/terms" className="underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Card>
    </main>
  );
}
