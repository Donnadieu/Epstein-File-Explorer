import type pg from "pg";

const migrations: { name: string; sql: string }[] = [
  {
    name: "pg_trgm extension",
    sql: "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  },
  {
    name: "idx_documents_r2_id (partial index for r2Filter)",
    sql: `CREATE INDEX IF NOT EXISTS idx_documents_r2_id
           ON documents (id)
           WHERE r2_key IS NOT NULL AND (file_size_bytes IS NULL OR file_size_bytes != 0)`,
  },
  {
    name: "idx_documents_title_trgm",
    sql: `CREATE INDEX IF NOT EXISTS idx_documents_title_trgm
           ON documents USING gin (title gin_trgm_ops)`,
  },
  {
    name: "idx_documents_description_trgm",
    sql: `CREATE INDEX IF NOT EXISTS idx_documents_description_trgm
           ON documents USING gin (description gin_trgm_ops)`,
  },
  {
    name: "idx_documents_key_excerpt_trgm",
    sql: `CREATE INDEX IF NOT EXISTS idx_documents_key_excerpt_trgm
           ON documents USING gin (key_excerpt gin_trgm_ops)`,
  },
  {
    name: "idx_persons_name_trgm",
    sql: `CREATE INDEX IF NOT EXISTS idx_persons_name_trgm
           ON persons USING gin (name gin_trgm_ops)`,
  },
  {
    name: "idx_timeline_events_title_trgm",
    sql: `CREATE INDEX IF NOT EXISTS idx_timeline_events_title_trgm
           ON timeline_events USING gin (title gin_trgm_ops)`,
  },
  {
    name: "idx_search_queries_zero_results (partial index for zero-result analytics)",
    sql: `CREATE INDEX IF NOT EXISTS idx_search_queries_zero_results
           ON search_queries (result_count, created_at)
           WHERE result_count = 0`,
  },
];

export async function runMigrations(pool: pg.Pool): Promise<void> {
  for (const { name, sql } of migrations) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      console.warn(`Migration skipped (${name}): ${err.message}`);
    }
  }
}
