/** Contracts first, each followed by its annexes/amendments (indented). */
export function orderContracts<T extends { id: string; parentContractId: string | null }>(
  rows: T[],
) {
  const children = new Map<string, T[]>();
  for (const r of rows) {
    if (r.parentContractId)
      children.set(r.parentContractId, [...(children.get(r.parentContractId) ?? []), r]);
  }
  const ids = new Set(rows.map((r) => r.id));
  return rows
    .filter((r) => !r.parentContractId || !ids.has(r.parentContractId))
    .flatMap((r) => [
      { row: r, depth: 0 },
      ...(children.get(r.id) ?? []).map((c) => ({ row: c, depth: 1 })),
    ]);
}

export function ExpiryBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return <span className="text-muted-foreground text-xs">No end date</span>;
  if (daysLeft < 0) return <span className="text-xs text-red-600 dark:text-red-400">Expired</span>;
  const soon = daysLeft <= 30;
  return (
    <span
      className={`text-xs ${soon ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
    >
      {daysLeft === 0 ? "Expires today" : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
    </span>
  );
}
