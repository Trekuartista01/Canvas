import { describe, expect, it } from "vitest";
import { allowedEmailMessage, isAllowedEmail, parseAllowedEmailDomains } from "./email-domain";

const domains = ["trekuartista.com"];

describe("isAllowedEmail", () => {
  it("allows the company domain, in any case", () => {
    expect(isAllowedEmail("olsi.sopi@trekuartista.com", domains)).toBe(true);
    expect(isAllowedEmail("Olsi.Sopi@TREKUARTISTA.COM", domains)).toBe(true);
  });

  it("refuses other addresses", () => {
    expect(isAllowedEmail("olsi@gmail.com", domains)).toBe(false);
  });

  it("refuses look-alikes", () => {
    expect(isAllowedEmail("a@trekuartista.com.evil.com", domains)).toBe(false);
    expect(isAllowedEmail("a@evil-trekuartista.com", domains)).toBe(false);
    expect(isAllowedEmail("a@mail.trekuartista.com", domains)).toBe(false);
    expect(isAllowedEmail("trekuartista.com@gmail.com", domains)).toBe(false);
    expect(isAllowedEmail('"a@trekuartista.com"@gmail.com', domains)).toBe(false);
  });

  it("refuses anything without a proper address", () => {
    expect(isAllowedEmail("trekuartista.com", domains)).toBe(false);
    expect(isAllowedEmail("@trekuartista.com", domains)).toBe(false);
    expect(isAllowedEmail("a@b@gmail.com", ["b@gmail.com"])).toBe(false);
  });

  it("refuses everyone if no domain is configured", () => {
    expect(isAllowedEmail("a@trekuartista.com", [])).toBe(false);
  });
});

describe("parseAllowedEmailDomains", () => {
  it("reads a comma-separated list, however it's typed", () => {
    expect(parseAllowedEmailDomains(" Trekuartista.com, @example.com ,")).toEqual([
      "trekuartista.com",
      "example.com",
    ]);
  });
});

describe("allowedEmailMessage", () => {
  it("names the domain", () => {
    expect(allowedEmailMessage(domains)).toBe(
      "Canvas is only for @trekuartista.com email addresses.",
    );
  });
});
