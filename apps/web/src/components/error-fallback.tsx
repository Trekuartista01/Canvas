import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

// Passed as Sentry.ErrorBoundary's `fallback` render prop (main.tsx) — the
// top-level catch for any otherwise-unhandled render error. Without this,
// an error anywhere in the tree unmounted the whole app with no feedback,
// just a blank page. Sentry.ErrorBoundary calls this regardless of whether
// a DSN is configured (reporting is a no-op then, per lib/sentry.ts), so
// the fallback UI itself never depends on Sentry actually being set up.
export function ErrorFallback({ error, resetError }: { error: unknown; resetError: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="bg-status-critical/10 text-status-critical flex h-12 w-12 items-center justify-center rounded-full">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          {error instanceof Error ? error.message : "An unexpected error occurred."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={resetError} data-testid="error-fallback-retry">
          Try again
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.location.reload()}
          data-testid="error-fallback-reload"
        >
          Reload page
        </Button>
      </div>
    </div>
  );
}
