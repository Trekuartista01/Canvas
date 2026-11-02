import { describe, expect, it } from "vitest";
import { uploadedTypeMatches } from "./storage";

describe("uploadedTypeMatches", () => {
  it("accepts the signed type, ignoring case and parameters", () => {
    expect(uploadedTypeMatches("image/png", "image/png")).toBe(true);
    expect(uploadedTypeMatches("Text/Plain; charset=utf-8", "text/plain")).toBe(true);
  });

  it("refuses a different type than the URL was signed for", () => {
    expect(uploadedTypeMatches("application/pdf", "text/plain")).toBe(false);
    expect(uploadedTypeMatches("text/html", "image/png")).toBe(false);
  });

  it("passes when the store reports no type", () => {
    expect(uploadedTypeMatches(undefined, "image/png")).toBe(true);
  });
});
