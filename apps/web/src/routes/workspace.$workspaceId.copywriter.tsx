import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { createRoute, Link } from "@tanstack/react-router";
import { Clock3, PenSquare } from "lucide-react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const copywriterListRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/copywriter",
  component: CopywriterListPage,
});

function CopywriterListPage() {
  const { workspaceId } = copywriterListRoute.useParams();
  const kits = trpc.brandKit.list.useQuery({ workspaceId });

  return (
    <div className="space-y-6 p-6" data-testid="copywriter-list-page">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
            <PenSquare className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Copywriter</h1>
            <p className="text-muted-foreground text-xs">
              Pick a brand kit, upload a design, get on-brand copy instantly.
            </p>
          </div>
        </div>
        <Link
          to="/w/$workspaceId/copywriter/history"
          params={{ workspaceId }}
          className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1.5" })}
        >
          <Clock3 className="h-3.5 w-3.5" aria-hidden />
          History
        </Link>
      </div>

      {kits.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (kits.data?.length ?? 0) === 0 ? (
        <Card className="text-muted-foreground space-y-3 p-6 text-center text-sm">
          <p>No brand kits yet — create one to start writing on-brand copy.</p>
          <Link
            to="/w/$workspaceId/brand-kits"
            params={{ workspaceId }}
            className={buttonVariants({ size: "sm" })}
          >
            Go to Brand Kits
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kits.data?.map((kit) => (
            <Link
              key={kit.id}
              to="/w/$workspaceId/copywriter/$brandKitId"
              params={{ workspaceId, brandKitId: kit.id }}
              data-testid={`copywriter-kit-${kit.id}`}
            >
              <Card className="hover:border-accent flex h-full flex-col gap-2 p-4 transition-colors">
                <p className="truncate text-sm font-semibold">{kit.name}</p>
                <p className="text-muted-foreground line-clamp-2 min-h-[2rem] text-xs">
                  {kit.tone || "No brand voice set yet"}
                </p>
                <span className="text-accent mt-auto text-xs font-medium">Open workspace →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
