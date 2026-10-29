import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pgPoolConfig } from "./connection";
import * as schema from "./schema/index";

const pool = new Pool(pgPoolConfig(process.env));

export const db = drizzle(pool, { schema });
