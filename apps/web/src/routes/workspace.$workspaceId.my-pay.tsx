import { trpc } from "@/lib/trpc";
import { formatEur } from "@canvas/shared";
import { createRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const myPayRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/my-pay",
  component: MyPayPage,
});

// M7.7: an employee's own payroll record — ID card and IBAN masked to the
// last 4. Viewing it is audited like any other payroll read, so it isn't
// refetched on window focus.
function MyPayPage() {
  const { workspaceId } = myPayRoute.useParams();
  const mine = trpc.payroll.mine.useQuery({ workspaceId }, { refetchOnWindowFocus: false });
  const data = mine.data;

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6" data-testid="my-pay-page">
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Wallet className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">My pay details</h1>
          <p className="text-muted-foreground text-xs">
            What HR has on file for your salary payments. Ask HR if anything is wrong.
          </p>
        </div>
      </div>
      {mine.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
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
              ["Net salary", `${formatEur(data.netSalaryEur)} / month`],
              ["Bank", data.bankName ?? "—"],
              ["Account holder", data.accountHolder ?? "—"],
              ["IBAN", data.iban ?? "—"],
              ["ID card number", data.idCardNumber ?? "—"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono text-right">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
