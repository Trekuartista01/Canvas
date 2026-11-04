import { Button } from "@/components/ui/button";
import { useModalA11y } from "@/hooks/use-modal-a11y";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@canvas/shared";
import { createRoute, useRouter } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const myPayRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/my-pay",
  component: MyPayPage,
});

function ConfirmOpen({ onCancel, onOpen }: { onCancel: () => void; onOpen: () => void }) {
  const { containerRef, onKeyDown } = useModalA11y(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="my-pay-confirm-title"
        tabIndex={-1}
        data-testid="my-pay-confirm"
        className="border-border bg-background w-full max-w-md space-y-4 rounded-lg border p-5 shadow-xl outline-none"
      >
        <p id="my-pay-confirm-title" className="text-sm">
          Kjo faqe përmban informacione konfidenciale. A jeni të sigurt që doni ta hapni? / This
          page contains confidential information. Are you sure you want to open it?
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onOpen}>
            Open
          </Button>
        </div>
      </div>
    </div>
  );
}

// P8.7 (spec §8): the caller's own payroll record, ID card and IBAN
// masked to the last 4. Nothing is requested until Open is clicked, and
// nothing stays in the query cache after leaving, so the question comes back
// on every visit. Each fetch is audited, so it isn't refetched on focus.
function MyPayPage() {
  const { workspaceId } = myPayRoute.useParams();
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [hidden, setHidden] = useState(false);
  const mine = trpc.payroll.mine.useQuery(
    { workspaceId },
    { enabled: opened, refetchOnWindowFocus: false, gcTime: 0 },
  );
  const data = mine.data;

  function goBack() {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: "/w/$workspaceId", params: { workspaceId } });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6" data-testid="my-pay-page">
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Wallet className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">My pay details</h1>
          <p className="text-muted-foreground text-xs">
            What HR has on file for your salary payments. Ask HR if anything is wrong.
          </p>
        </div>
        {data && (
          <Button
            size="sm"
            variant="outline"
            aria-pressed={hidden}
            onClick={() => setHidden(!hidden)}
            data-testid="my-pay-hide"
          >
            {hidden ? "Show" : "Hide"}
          </Button>
        )}
      </div>

      {!opened ? (
        <ConfirmOpen onCancel={goBack} onOpen={() => setOpened(true)} />
      ) : mine.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : mine.error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {mine.error.message}
        </p>
      ) : !data ? (
        <p className="text-muted-foreground text-sm" data-testid="my-pay-empty">
          HR hasn't entered your pay details yet.
        </p>
      ) : (
        <dl
          className="border-border divide-border divide-y rounded-md border text-sm"
          data-testid="my-pay-details"
        >
          {(
            [
              ["Net salary", `${formatMoney(data.netSalaryEur, data.payCurrency)} / month`],
              ["Bank", data.bankName ?? "—"],
              ["Account holder", data.accountHolder ?? "—"],
              ["IBAN", data.iban ?? "—"],
              ["ID card number", data.idCardNumber ?? "—"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd
                className={`text-right font-mono ${hidden ? "blur-sm select-none" : ""}`}
                aria-hidden={hidden}
                data-testid={`my-pay-value-${label}`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
