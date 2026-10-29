import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

export const DEFAULT_DATABASE_URL = "postgres://canvas:canvas@localhost:5432/canvas";

// Supabase's free tier caps total connections low, and its Session pooler
// holds one server connection per client connection — so each process keeps
// a small pool (api ~5, worker ~3 via DB_POOL_MAX in ecosystem.config.cjs).
export const DEFAULT_POOL_MAX = 5;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// pg parses ssl-related query params out of the connection string and lets
// them *override* the `ssl` object passed alongside it — a Supabase string
// carrying `?sslmode=require` would silently turn our explicit TLS config
// into full verification against the system CA store and fail on the
// pooler's certificate chain. Strip them so `ssl` below is the only source.
const SSL_PARAMS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"];

export interface ConnectionEnv {
  DATABASE_URL?: string;
  DB_POOL_MAX?: string;
  /** PEM contents, or a path to a PEM file (Supabase dashboard → Database → SSL). */
  SUPABASE_CA_CERT?: string;
}

function loadCa(value: string): string {
  if (value.includes("BEGIN CERTIFICATE")) return value.replace(/\\n/g, "\n");
  return readFileSync(value, "utf8");
}

/**
 * Pure: turns env vars into a node-postgres Pool config. TLS is on for any
 * non-local host (Supabase, CI never uses it). With SUPABASE_CA_CERT the
 * server certificate is fully verified against that CA; without it the
 * connection is still encrypted but the chain isn't verified (Supabase's
 * pooler certificate isn't signed by a public CA).
 */
export function pgPoolConfig(env: ConnectionEnv, readCa: (value: string) => string = loadCa) {
  const url = new URL(env.DATABASE_URL || DEFAULT_DATABASE_URL);
  for (const param of SSL_PARAMS) url.searchParams.delete(param);

  const isLocal = LOCAL_HOSTS.has(url.hostname);
  const ssl: PoolConfig["ssl"] = isLocal
    ? false
    : env.SUPABASE_CA_CERT
      ? { ca: readCa(env.SUPABASE_CA_CERT), rejectUnauthorized: true }
      : { rejectUnauthorized: false };

  const parsedMax = Number(env.DB_POOL_MAX);
  const max = Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_POOL_MAX;

  return { connectionString: url.toString(), ssl, max } satisfies PoolConfig;
}
