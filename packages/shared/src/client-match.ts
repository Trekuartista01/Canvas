// P8.10 (docs/hr-ops-spec.md §11): which clients a card's text mentions.

export const CLIENT_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#16a34a",
  "#0891b2",
  "#475569",
] as const;

/** The colour a new client starts with, stable for a given name. */
export function defaultClientColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 1000;
  return CLIENT_COLORS[hash % CLIENT_COLORS.length] ?? CLIENT_COLORS[0];
}

/** Lowercase, without diacritics: ë→e, ç→c. */
export function foldForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `term` as whole words in already-folded text. */
function mentions(foldedText: string, term: string) {
  const folded = foldForMatch(term).trim();
  if (!folded) return false;
  const pattern = escapeRegExp(folded).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "u").test(foldedText);
}

/** Every client whose name or an alias appears in the text. */
export function matchClients<C extends { name: string; aliases: string[] }>(
  text: string,
  clients: C[],
): C[] {
  const folded = foldForMatch(text);
  return clients.filter((c) => [c.name, ...c.aliases].some((term) => mentions(folded, term)));
}

/**
 * The client an automatically linked card should have now. One match links it.
 * Several are left for a person to pick, unless the current one is among them.
 */
export function autoClientFor(matchedIds: string[], currentId: string | null): string | null {
  if (matchedIds.length === 1) return matchedIds[0] ?? null;
  return currentId && matchedIds.includes(currentId) ? currentId : null;
}
