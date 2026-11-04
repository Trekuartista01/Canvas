// M7.7 payroll helpers shared by the API (validation) and the web form.

/** Uppercase, no spaces — how an IBAN is stored (encrypted) and validated. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** ISO 13616 check: country code, check digits, mod-97 == 1. */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** "XK05 1212 0123 4567 8906" — grouped for display/export. */
export function formatIban(value: string): string {
  return normalizeIban(value)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/**
 * "1.234,50 €" — the money format used in Kosovo. de-DE produces exactly that
 * and ships with every ICU build; sq-XK isn't available everywhere (Chrome
 * falls back to "€1,234.50"). P8.7: in the person's pay currency.
 */
export function formatMoney(amount: number | null, currency = "EUR"): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
}

/**
 * Net salaries added up per currency, EUR first: amounts in different
 * currencies are never summed together.
 */
export function totalsByCurrency(
  rows: { netSalaryEur: number | null; payCurrency: string }[],
): { currency: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const { netSalaryEur, payCurrency } of rows) {
    if (netSalaryEur === null) continue;
    totals.set(payCurrency, (totals.get(payCurrency) ?? 0) + netSalaryEur);
  }
  return [...totals]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) =>
      a.currency === "EUR" ? -1 : b.currency === "EUR" ? 1 : a.currency.localeCompare(b.currency),
    );
}
