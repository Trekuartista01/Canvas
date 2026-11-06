import type { AppRouter } from "@canvas/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { trpc } from "@/lib/trpc";
import {
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPES,
  PAY_CURRENCIES,
  type ContractType,
  type PayCurrency,
} from "@canvas/shared";
import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { useState, type FormEvent } from "react";

type Confidential = inferRouterOutputs<AppRouter>["people"]["confidential"];

/**
 * P8.3 Confidential tab (spec §5): HR only. The server sends these fields to
 * HR alone (people.confidential, audited); nothing here is hidden client-side.
 */
export function ConfidentialPanel({
  workspaceId,
  profile,
}: {
  workspaceId: string;
  profile: { userId: string };
}) {
  const query = trpc.people.confidential.useQuery({ workspaceId, userId: profile.userId });
  if (query.isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (query.error || !query.data) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {query.error?.message ?? "Couldn't load the confidential details."}
      </p>
    );
  }
  return (
    <div className="space-y-6" data-testid="person-confidential">
      <TermsForm
        key={JSON.stringify(query.data)}
        workspaceId={workspaceId}
        userId={profile.userId}
        data={query.data}
      />
      <BankDetails workspaceId={workspaceId} data={query.data} />
      <Allowances workspaceId={workspaceId} userId={profile.userId} data={query.data} />
    </div>
  );
}

const moneyOrNull = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100) / 100);

function TermsForm({
  workspaceId,
  userId,
  data,
}: {
  workspaceId: string;
  userId: string;
  data: Confidential;
}) {
  const { user } = useSession();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState({
    personalNumber: data.personalNumber ?? "",
    payCurrency: data.payCurrency as PayCurrency,
    contractType: (data.contractType ?? "") as ContractType | "",
    contractStart: data.contractStart ?? "",
    contractEnd: data.contractEnd ?? "",
    grossSalary: data.grossSalary?.toString() ?? "",
    netSalary: data.netSalary?.toString() ?? "",
  });
  const save = trpc.people.updateConfidential.useMutation({
    onSuccess: () => utils.people.confidential.invalidate({ workspaceId, userId }),
  });
  const self = user?.id === userId;
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({
      workspaceId,
      userId,
      personalNumber: draft.personalNumber.trim() || null,
      payCurrency: draft.payCurrency,
      contractType: draft.contractType || null,
      contractStart: draft.contractStart,
      contractEnd: draft.contractType === "open_ended" ? "" : draft.contractEnd,
      grossSalary: moneyOrNull(draft.grossSalary),
      netSalary: moneyOrNull(draft.netSalary),
    });
  }

  return (
    <form
      onSubmit={submit}
      className="border-border space-y-3 rounded-md border p-4"
      data-testid="person-terms-form"
    >
      <h2 className="text-base font-semibold">Employment and pay</h2>
      <fieldset disabled={self || save.isPending} className="grid gap-3 sm:grid-cols-2">
        <Field id="conf-personal-number" label="Personal number">
          <Input
            id="conf-personal-number"
            value={draft.personalNumber}
            onChange={(e) => set({ personalNumber: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <Field id="conf-currency" label="Pay currency">
          <select
            id="conf-currency"
            value={draft.payCurrency}
            onChange={(e) => set({ payCurrency: e.target.value as PayCurrency })}
            className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            {PAY_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field id="conf-gross" label="Gross salary">
          <Input
            id="conf-gross"
            type="number"
            min={0}
            step="0.01"
            value={draft.grossSalary}
            onChange={(e) => set({ grossSalary: e.target.value })}
          />
        </Field>
        <Field id="conf-net" label="Net salary">
          <Input
            id="conf-net"
            type="number"
            min={0}
            step="0.01"
            value={draft.netSalary}
            onChange={(e) => set({ netSalary: e.target.value })}
          />
        </Field>
        <Field id="conf-contract-type" label="Contract type">
          <select
            id="conf-contract-type"
            value={draft.contractType}
            onChange={(e) => set({ contractType: e.target.value as ContractType | "" })}
            className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="">Not set</option>
            {CONTRACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTRACT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="conf-contract-start" label="Contract start">
            <Input
              id="conf-contract-start"
              type="date"
              value={draft.contractStart}
              onChange={(e) => set({ contractStart: e.target.value })}
            />
          </Field>
          {draft.contractType !== "open_ended" && (
            <Field id="conf-contract-end" label="Contract end">
              <Input
                id="conf-contract-end"
                type="date"
                value={draft.contractEnd}
                onChange={(e) => set({ contractEnd: e.target.value })}
              />
            </Field>
          )}
        </div>
      </fieldset>
      {self && (
        <p className="text-muted-foreground text-xs">
          Someone else in HR has to change your own details.
        </p>
      )}
      {save.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {save.error.message}
        </p>
      )}
      {!self && (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={save.isPending} data-testid="person-terms-save">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {save.isSuccess && !save.isPending && (
            <span className="text-muted-foreground text-xs">Saved</span>
          )}
        </div>
      )}
    </form>
  );
}

function BankDetails({ workspaceId, data }: { workspaceId: string; data: Confidential }) {
  return (
    <section className="bg-card shadow-sm border-border space-y-2 rounded-md border p-4">
      <div className="flex items-center">
        <h2 className="mr-auto text-base font-semibold">Bank details</h2>
        <Link
          to="/w/$workspaceId/payroll"
          params={{ workspaceId }}
          className="text-accent text-xs hover:underline"
        >
          Edit in Payroll
        </Link>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Item label="Bank" value={data.bankName} />
        <Item label="Account holder" value={data.accountHolder} />
        <Item label="IBAN" value={data.iban} />
        <Item label="ID card number" value={data.idCardNumber} />
      </dl>
    </section>
  );
}

function Allowances({
  workspaceId,
  userId,
  data,
}: {
  workspaceId: string;
  userId: string;
  data: Confidential;
}) {
  const utils = trpc.useUtils();
  const setBalance = trpc.leave.setBalance.useMutation({
    onSuccess: () => utils.people.confidential.invalidate({ workspaceId, userId }),
  });
  const days = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <section
      className="bg-card shadow-sm border-border space-y-2 rounded-md border p-4"
      data-testid="person-allowances"
    >
      <h2 className="text-base font-semibold">Annual leave allowance</h2>
      <p className="text-muted-foreground text-xs">
        Working days per year. Empty = the days for their time here. Balance = allowed + carried
        over − approved − pending.
      </p>
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="py-1 font-normal">Year</th>
            <th className="py-1 font-normal">Allowed</th>
            <th className="py-1 font-normal">Carried over</th>
            <th className="py-1 font-normal">Used</th>
            <th className="py-1 font-normal">Pending</th>
            <th className="py-1 font-normal">Left</th>
          </tr>
        </thead>
        <tbody>
          {data.allowances.map((a) => (
            <tr key={a.year} className="border-border border-t" data-testid={`allowance-${a.year}`}>
              <td className="py-1.5 font-medium tabular-nums">{a.year}</td>
              <td className="py-1.5">
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  aria-label={`Allowed days ${a.year}`}
                  placeholder={String(a.balance.entitlement)}
                  defaultValue={a.entitlementOverride ?? ""}
                  onBlur={(e) => {
                    const value = days(e.target.value);
                    if (value !== a.entitlementOverride) {
                      setBalance.mutate({
                        workspaceId,
                        userId,
                        year: a.year,
                        entitlementDays: value,
                      });
                    }
                  }}
                  className="h-8 w-20 text-sm"
                />
              </td>
              <td className="py-1.5">
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  aria-label={`Carried over ${a.year}`}
                  placeholder={String(a.balance.carriedOver)}
                  defaultValue={a.carriedOverStored ?? ""}
                  onBlur={(e) => {
                    const value = days(e.target.value);
                    if (value !== a.carriedOverStored) {
                      setBalance.mutate({
                        workspaceId,
                        userId,
                        year: a.year,
                        carriedOverDays: value,
                      });
                    }
                  }}
                  className="h-8 w-20 text-sm"
                />
              </td>
              <td className="py-1.5 tabular-nums">{a.balance.used}</td>
              <td className="py-1.5 tabular-nums">{a.balance.pending}</td>
              <td className="py-1.5 font-medium tabular-nums">{a.balance.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {setBalance.error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {setBalance.error.message}
        </p>
      )}
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="break-all">{value || "—"}</dd>
    </div>
  );
}
