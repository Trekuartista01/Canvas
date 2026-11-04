import { describe, expect, it } from "vitest";
import { formatIban, formatMoney, isValidIban, normalizeIban, totalsByCurrency } from "./payroll";

describe("IBAN", () => {
  it("accepts valid IBANs, with or without spaces", () => {
    expect(isValidIban("XK051212012345678906")).toBe(true); // Kosovo
    expect(isValidIban("xk05 1212 0123 4567 8906")).toBe(true);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
  });

  it("rejects a wrong check digit or malformed value", () => {
    expect(isValidIban("XK051212012345678907")).toBe(false);
    expect(isValidIban("XK05")).toBe(false);
    expect(isValidIban("1234567890123456")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });

  it("normalizes and groups", () => {
    expect(normalizeIban(" xk05 1212\t0123 4567 8906 ")).toBe("XK051212012345678906");
    expect(formatIban("XK051212012345678906")).toBe("XK05 1212 0123 4567 8906");
  });
});

describe("formatMoney in other currencies", () => {
  it("uses the person's pay currency", () => {
    expect(formatMoney(1234.5, "USD")).toBe("1.234,50\u00a0$");
    expect(formatMoney(null, "USD")).toBe("—");
  });
});

describe("totalsByCurrency", () => {
  it("adds up per currency, EUR first, skipping people with no salary", () => {
    expect(
      totalsByCurrency([
        { netSalaryEur: 100, payCurrency: "USD" },
        { netSalaryEur: 650.5, payCurrency: "EUR" },
        { netSalaryEur: null, payCurrency: "CHF" },
        { netSalaryEur: 50, payCurrency: "USD" },
        { netSalaryEur: 10, payCurrency: "ALL" },
      ]),
    ).toEqual([
      { currency: "EUR", total: 650.5 },
      { currency: "ALL", total: 10 },
      { currency: "USD", total: 150 },
    ]);
  });

  it("is empty with no salaries", () => {
    expect(totalsByCurrency([{ netSalaryEur: null, payCurrency: "EUR" }])).toEqual([]);
  });
});
