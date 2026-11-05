import { describe, expect, it } from "vitest";
import { envFlag } from "./env-flag";

describe("envFlag", () => {
  it('reads "false" as false', () => {
    expect(envFlag(true).parse("false")).toBe(false);
    expect(envFlag(false).parse("false")).toBe(false);
  });

  it('reads "true" as true', () => {
    expect(envFlag(false).parse("true")).toBe(true);
  });

  it("uses the fallback when unset or left blank", () => {
    expect(envFlag(true).parse(undefined)).toBe(true);
    expect(envFlag(false).parse(undefined)).toBe(false);
    expect(envFlag(true).parse("")).toBe(true);
    expect(envFlag(false).parse("")).toBe(false);
  });

  it("refuses anything else", () => {
    expect(envFlag(false).safeParse("flase").success).toBe(false);
  });
});
