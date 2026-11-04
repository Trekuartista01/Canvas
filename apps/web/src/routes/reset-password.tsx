import { CanvasLogo } from "@/components/canvas-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { rootRoute } from "./__root";

export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: z.object({ token: z.string().min(1).optional() }),
  component: ResetPasswordPage,
});

// Reached from the emailed link. Afterwards every device is signed out, so this
// goes to the login page rather than signing in.
function ResetPasswordPage() {
  const { token } = resetPasswordRoute.useSearch();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [password, setPassword] = useState("");
  const details = trpc.auth.passwordResetDetails.useQuery(
    { token: token ?? "" },
    { enabled: Boolean(token), retry: false, refetchOnWindowFocus: false },
  );
  const complete = trpc.auth.completePasswordReset.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate(undefined, { refetchType: "all" });
      void navigate({ to: "/login", search: { reset: true } });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (token) complete.mutate({ token, password });
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4">
      <Card className="w-full max-w-sm space-y-6 p-6">
        <div className="flex items-center gap-3">
          <CanvasLogo size={64} />
          <h1 className="text-xl font-semibold">Choose a new password</h1>
        </div>

        {!token || details.error ? (
          <div className="space-y-3 text-sm" data-testid="reset-link-invalid">
            <p>
              {details.error?.message ??
                "This link is missing its code. Open it from your email again."}
            </p>
            <Link to="/forgot-password" className="underline">
              Send a new link
            </Link>
          </div>
        ) : details.isLoading ? (
          <p className="text-muted-foreground text-sm">Checking your link…</p>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <p className="text-muted-foreground text-sm">
              For <strong className="text-foreground">{details.data?.email}</strong>. This signs you
              out on every device.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoFocus
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {complete.error && (
              <p className="text-sm text-red-500" role="alert">
                {complete.error.message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={complete.isPending}>
              {complete.isPending ? "Saving…" : "Save new password"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
