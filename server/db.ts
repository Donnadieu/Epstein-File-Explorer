import { drizzle } from "drizzle-orm/node-postgres";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import * as schema from "@shared/schema";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const { Pool } = pg;

// Allow optional database for testing/tool-only mode
let pool: pg.Pool;
let db: any;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  db = drizzle(pool, { schema });
} else {
  // Create a minimal dummy pool for tool-only mode (no database required)
  console.warn("⚠️  DATABASE_URL not set - database features will be unavailable");
  pool = {} as any;
  db = {} as any;
}

export { pool, db };
