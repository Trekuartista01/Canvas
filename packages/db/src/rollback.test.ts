import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { entryToRollBack, splitStatements } from "./rollback";

const drizzleDir = resolve(__dirname, "../drizzle");

describe("splitStatements", () => {
  it("splits on drizzle's breakpoint and drops comment-only chunks", () => {
    expect(
      splitStatements(
        "-- header\nSELECT 1;--> statement-breakpoint\n-- only a comment\n--> statement-breakpoint\nSELECT 2;",
      ),
    ).toEqual(["-- header\nSELECT 1;", "SELECT 2;"]);
  });
});

describe("entryToRollBack", () => {
  const entries = [
    { idx: 0, tag: "0000_a", when: 1 },
    { idx: 1, tag: "0001_b", when: 2 },
  ];

  it("returns the newest entry when it's the newest applied", () => {
    expect(entryToRollBack(entries, 2).tag).toBe("0001_b");
  });

  it("refuses when the database and the journal disagree", () => {
    expect(() => entryToRollBack(entries, 1)).toThrow(/isn't the journal's newest/);
    expect(() => entryToRollBack(entries, null)).toThrow(/No migrations/);
    expect(() => entryToRollBack([], 1)).toThrow(/empty/);
  });
});

describe("down migrations", () => {
  it("exist for every migration from 0064 on", () => {
    const journal = JSON.parse(readFileSync(resolve(drizzleDir, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const downs = new Set(readdirSync(resolve(drizzleDir, "down")));
    for (const entry of journal.entries.filter((e) => e.idx >= 64)) {
      expect(downs.has(`${entry.tag}.down.sql`), entry.tag).toBe(true);
    }
  });
});
