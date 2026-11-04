import { describe, expect, it } from "vitest";
import { autoClientFor, defaultClientColor, CLIENT_COLORS, matchClients } from "./client-match";

const zone = { id: "zone", name: "Zone Club", aliases: ["Zone", "Zone Club Prishtina"] };
const lena = { id: "lena", name: "Lëndita Çeku", aliases: [] };
const art = { id: "art", name: "Art", aliases: [] };
const clients = [zone, lena, art];
const ids = (text: string) => matchClients(text, clients).map((c) => c.id);

describe("matchClients", () => {
  it("finds the spec's example by alias", () => {
    expect(ids("Zone – story posts")).toEqual(["zone"]);
  });

  it("is case-insensitive", () => {
    expect(ids("ZONE CLUB poster")).toEqual(["zone"]);
  });

  it("only matches whole words", () => {
    expect(ids("Time zones and ozone")).toEqual([]);
    expect(ids("Smart art direction")).toEqual(["art"]);
    expect(ids("Smartart")).toEqual([]);
  });

  it("ignores Albanian diacritics, both ways round", () => {
    expect(ids("Poster for Lendita Ceku")).toEqual(["lena"]);
    expect(matchClients("Zonë posts", [zone]).map((c) => c.id)).toEqual(["zone"]);
  });

  it("copes with extra spaces and punctuation around a name", () => {
    expect(ids("(Zone   Club), new menu")).toEqual(["zone"]);
  });

  it("returns every client mentioned", () => {
    expect(ids("Zone and Art collaboration")).toEqual(["zone", "art"]);
  });

  it("treats regex characters in a name literally", () => {
    const odd = { id: "odd", name: "A+B (Co.)", aliases: [] };
    expect(matchClients("Work for A+B (Co.) today", [odd])).toHaveLength(1);
    expect(matchClients("Work for AAB (Cox) today", [odd])).toHaveLength(0);
  });

  it("skips blank aliases", () => {
    expect(matchClients("anything", [{ name: "X1", aliases: ["  "] }])).toEqual([]);
  });
});

describe("autoClientFor", () => {
  it("links a single match", () => {
    expect(autoClientFor(["zone"], null)).toBe("zone");
    expect(autoClientFor(["zone"], "art")).toBe("zone");
  });

  it("leaves several matches to a person", () => {
    expect(autoClientFor(["zone", "art"], null)).toBeNull();
  });

  it("keeps the current client when it's still mentioned", () => {
    expect(autoClientFor(["zone", "art"], "art")).toBe("art");
  });

  it("clears when nothing matches any more", () => {
    expect(autoClientFor([], "zone")).toBeNull();
  });
});

describe("defaultClientColor", () => {
  it("is stable and from the palette", () => {
    expect(defaultClientColor("Zone Club")).toBe(defaultClientColor("Zone Club"));
    expect(CLIENT_COLORS).toContain(defaultClientColor("Zone Club"));
  });
});
