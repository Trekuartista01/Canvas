import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * M7.7 field-level encryption for payroll secrets (ID-card numbers, IBANs).
 * AES-256-GCM, a fresh random 96-bit IV per value, and the 128-bit auth tag
 * checked on decrypt — a tampered or truncated value throws instead of
 * returning garbage.
 *
 * Stored as "v1.<base64 iv|ciphertext|tag>". The version prefix leaves room
 * for key rotation later. `context` is bound in as additional authenticated
 * data (e.g. "workspace:user:iban"), so a value copied into another
 * person's row, or into the other field, fails to decrypt.
 *
 * Callers must never log or return the plaintext anywhere it isn't needed.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyBuffer(key: string) {
  const buffer = Buffer.from(key, "base64");
  if (buffer.length !== 32) throw new Error("Encryption key must be 32 bytes (base64)");
  return buffer;
}

export function encryptField(plaintext: string, key: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(key), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64")}`;
}

export function decryptField(stored: string, key: string, context: string): string {
  const [version, payload] = stored.split(".", 2);
  if (version !== VERSION || !payload) throw new Error("Unsupported encrypted value");
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Encrypted value is truncated");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(key), iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  // A wrong key, wrong context or any altered byte makes final() throw.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** "•••• 8906" — what an employee sees of their own number/IBAN. */
export function maskLast4(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, "");
  return compact.length <= 4 ? "••••" : `•••• ${compact.slice(-4)}`;
}
