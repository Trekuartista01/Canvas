import { describe, expect, it } from "vitest";
import { searchTokens } from "./search-tokens";

describe("searchTokens", () => {
  it("splits on spaces and lowercases", () => {
    expect(searchTokens("  Olsi   SOPI ")).toEqual(["olsi", "sopi"]);
  });

  it("folds Albanian letters", () => {
    expect(searchTokens("Lëndita Çeku")).toEqual(["lendita", "ceku"]);
    expect(searchTokens("LËNDITA ÇEKU")).toEqual(["lendita", "ceku"]);
  });

  it("escapes LIKE wildcards, so % doesn't match everyone", () => {
    expect(searchTokens("100% a_b c\\d")).toEqual(["100\\%", "a\\_b", "c\\\\d"]);
  });

  it("has no words for a blank query", () => {
    expect(searchTokens("   ")).toEqual([]);
  });

  it("stops at six words", () => {
    expect(searchTokens("a b c d e f g h")).toHaveLength(6);
  });
});
