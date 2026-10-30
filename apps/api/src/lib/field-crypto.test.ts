import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, maskLast4 } from "./field-crypto";

const key = randomBytes(32).toString("base64");
const otherKey = randomBytes(32).toString("base64");
const ctx = "ws-1:user-1:iban";

describe("field-crypto", () => {
  it("round-trips, including non-ASCII", () => {
    const iban = "XK051212012345678906";
    expect(decryptField(encryptField(iban, key, ctx), key, ctx)).toBe(iban);
    expect(decryptField(encryptField("Ç-ë 123", key, ctx), key, ctx)).toBe("Ç-ë 123");
  });

  it("never stores the plaintext and uses a fresh IV each time", () => {
    const a = encryptField("1234567890", key, ctx);
    const b = encryptField("1234567890", key, ctx);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("1234567890");
    expect(Buffer.from(a.slice(3), "base64").toString("latin1")).not.toContain("1234567890");
  });

  it("rejects the wrong key", () => {
    expect(() => decryptField(encryptField("secret", key, ctx), otherKey, ctx)).toThrow();
  });

  it("rejects a value moved to another row or field (context is authenticated)", () => {
    const stored = encryptField("secret", key, ctx);
    expect(() => decryptField(stored, key, "ws-1:user-2:iban")).toThrow();
    expect(() => decryptField(stored, key, "ws-1:user-1:idCard")).toThrow();
  });

  it("rejects tampered and truncated values", () => {
    const stored = encryptField("secret", key, ctx);
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[14] = raw[14]! ^ 0xff;
    expect(() => decryptField(`v1.${raw.toString("base64")}`, key, ctx)).toThrow();
    expect(() => decryptField("v1.AAAA", key, ctx)).toThrow(/truncated/);
    expect(() => decryptField("v2.whatever", key, ctx)).toThrow(/Unsupported/);
  });

  it("refuses a key that isn't 32 bytes", () => {
    expect(() => encryptField("x", Buffer.alloc(16).toString("base64"), ctx)).toThrow(/32 bytes/);
  });
});

describe("maskLast4", () => {
  it("shows only the last four characters", () => {
    expect(maskLast4("XK05 1212 0123 4567 8906")).toBe("•••• 8906");
    expect(maskLast4("1234567890")).toBe("•••• 7890");
    expect(maskLast4("123")).toBe("••••");
    expect(maskLast4(null)).toBeNull();
  });
});
