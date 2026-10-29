import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";
import { pgPoolConfig } from "./src/connection";

// drizzle-kit doesn't load .env itself — read the repo-root one (same file
// apps/api/src/env.ts uses) so `pnpm db:migrate` hits the Supabase project
// configured there. Real environment variables still win.
const rootEnv = resolve(__dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Same TLS rules as the app's own pool (src/connection.ts). drizzle-kit only
// accepts `ssl` alongside discrete credentials, not a bare `url`.
const { connectionString, ssl } = pgPoolConfig(process.env);
const url = new URL(connectionString);

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl,
  },
});
