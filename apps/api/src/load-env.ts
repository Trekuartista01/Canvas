import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Side-effect module: must be the FIRST import of every entrypoint
// (index.ts, worker.ts). @canvas/db builds its connection pool from
// process.env at import time, so .env has to be loaded before that module
// is evaluated — otherwise DATABASE_URL silently falls back to localhost.
//
// Explicit absolute path, not a bare config() call — turbo/tsx run this
// package's scripts (dev/worker) with apps/api as cwd, not the repo root
// where .env actually lives, so dotenv's default cwd-relative lookup would
// silently find nothing and every var would fall back to its default.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });
