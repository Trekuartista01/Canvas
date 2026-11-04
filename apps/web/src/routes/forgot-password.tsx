import { CanvasLogo } from "@/components/canvas-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { createRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { rootRoute } from "./__root";

export const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const request = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSentTo(email),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    request.mutate({ email });
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4">
      <Card className="w-full max-w-sm space-y-6 p-6">
        <div className="flex items-center gap-3">
          <CanvasLogo size={64} />
          <h1 className="text-xl font-semibold">Forgot your password?</h1>
        </div>

        {sentTo ? (
          <div className="space-y-2 text-sm" data-testid="reset-sent">
            <p>
              If <strong>{sentTo}</strong> has a Canvas account, we've sent it a link to choose a
              new password.
            </p>
            <p className="text-muted-foreground">
              It works for 1 hour. Check your junk folder if you don't see it.
            </p>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <p className="text-muted-foreground text-sm">
              Enter your work email and we'll send you a link to choose a new password.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoFocus
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {request.error && (
              <p className="text-sm text-red-500" role="alert">
                {request.error.message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={request.isPending}>
              {request.isPending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="text-muted-foreground text-center text-sm">
          <Link to="/login" className="text-foreground underline">
            Back to log in
          </Link>
        </p>
      </Card>
    </main>
  );
}
