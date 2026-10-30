import type { AppRouter } from "@canvas/api";
import { ExpiryBadge, orderContracts } from "@/components/contract-list-helpers";
import { Button } from "@/components/ui/button";
import { openSignedDownload } from "@/hooks/use-private-upload";
import { formatReportDate } from "@/lib/daily-report-format";
import { trpc } from "@/lib/trpc";
import { CONTRACT_KIND_LABELS } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { FileSignature } from "lucide-react";
import { useMemo, useRef } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const myContractRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/my-contract",
  component: MyContractPage,
});

type Contract = inferRouterOutputs<AppRouter>["contract"]["mine"][number];

// M7.6 "My Contract": only the employee's own documents.
function MyContractPage() {
  const { workspaceId } = myContractRoute.useParams();
  const mine = trpc.contract.mine.useQuery({ workspaceId });
  const rows = useMemo(() => orderContracts<Contract>(mine.data ?? []), [mine.data]);
  const download = trpc.contract.downloadUrl.useMutation({
    onSuccess: (r) => openSignedDownload(r.url),
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 58,
    overscan: 8,
  });

  return (
    <div
      className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6"
      data-testid="my-contract-page"
    >
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <FileSignature className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">My contract</h1>
          <p className="text-muted-foreground text-xs">
            Your employment contract and its annexes. Only you and HR can see these.
          </p>
        </div>
      </div>

      {mine.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="my-contract-empty">
          HR hasn't filed a contract for you yet.
        </p>
      ) : (
        <div
          ref={parentRef}
          className="min-h-0 flex-1 overflow-auto"
          data-testid="my-contract-list"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const { row, depth } = rows[item.index]!;
              return (
                <div
                  key={row.id}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)`, paddingLeft: depth * 24 }}
                >
                  <div
                    className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
                    data-testid={`contract-${row.title}`}
                  >
                    <span className="bg-muted rounded-full px-2 py-0.5 text-[11px]">
                      {CONTRACT_KIND_LABELS[row.kind]}
                    </span>
                    <span className="font-medium">{row.title}</span>
                    <span className="text-muted-foreground text-xs">
                      From {formatReportDate(row.startDate)}
                      {row.expiryDate && ` to ${formatReportDate(row.expiryDate)}`}
                    </span>
                    <ExpiryBadge daysLeft={row.daysLeft} />
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={download.isPending}
                      onClick={() => download.mutate({ contractId: row.id })}
                    >
                      Download
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {download.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {download.error.message}
        </p>
      )}
    </div>
  );
}
