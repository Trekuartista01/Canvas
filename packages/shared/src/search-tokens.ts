const MAX_WORDS = 6;

/**
 * The words of a name search, lowercased, with Albanian ë and ç folded to e and
 * c (the database side folds the same way) and LIKE's wildcards escaped.
 */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/ë/g, "e")
    .replace(/ç/g, "c")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .map((word) => word.replace(/[\\%_]/g, (ch) => `\\${ch}`));
}
