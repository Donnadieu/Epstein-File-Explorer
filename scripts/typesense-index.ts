/**
 * Bulk-indexes document_pages or persons into Typesense.
 *
 * Usage:
 *   DATABASE_URL=... TYPESENSE_HOST=... TYPESENSE_API_KEY=... npx tsx scripts/typesense-index.ts
 *   npx tsx scripts/typesense-index.ts --start-from=2500000   # resume from ID
 *   npx tsx scripts/typesense-index.ts --dry-run               # validate without writing
 *   npx tsx scripts/typesense-index.ts --collection=persons    # index persons table
 */
import "dotenv/config";
import Typesense from "typesense";
import pg from "pg";
import {
  COLLECTION_NAME, COLLECTION_SCHEMA,
  PERSONS_COLLECTION, PERSONS_SCHEMA,
  DOCUMENT_PAGE_SYNONYMS, PERSONS_SYNONYMS,
  upsertSynonyms, upsertOneWaySynonyms, buildAliasSynonyms,
} from "../server/typesense";

const BATCH_SIZE = 5000;
const LOG_EVERY = 50_000;

interface RawRow {
  id: number;
  document_id: number;
  page_number: number;
  content: string;
  page_type: string | null;
  title: string;
  document_type: string;
  data_set: string | null;
  r2_key: string | null;
  file_size_bytes: number | null;
}

interface RawPersonRow {
  id: number;
  name: string;
  aliases: string[] | null;
  role: string;
  description: string;
  occupation: string | null;
  category: string;
}

function isViewable(row: RawRow, r2Configured: boolean): boolean {
  if (row.file_size_bytes === 0) return false;
  if (r2Configured && !row.r2_key) return false;
  return true;
}

async function indexPersons(
  pool: pg.Pool,
  tsClient: InstanceType<typeof Typesense.Client>,
  dryRun: boolean,
) {
  if (!dryRun) {
    try {
      await tsClient.collections(PERSONS_COLLECTION).delete();
      console.log(`Dropped existing collection: ${PERSONS_COLLECTION}`);
    } catch {
      // Collection may not exist
    }
    await tsClient.collections().create(PERSONS_SCHEMA);
    console.log(`Created collection: ${PERSONS_COLLECTION}`);

    // Upsert static synonyms
    console.log("Upserting static synonyms for persons...");
    await upsertSynonyms(tsClient, PERSONS_COLLECTION, PERSONS_SYNONYMS);

    // Upsert alias-based one-way synonyms from DB
    console.log("Building alias-based synonyms from persons table...");
    const { rows: aliasRows } = await pool.query<{ id: number; name: string; aliases: string[] | null }>(
      `SELECT id, name, aliases FROM persons WHERE aliases IS NOT NULL AND array_length(aliases, 1) > 0`,
    );
    const aliasSynonyms = buildAliasSynonyms(aliasRows);
    if (aliasSynonyms.length > 0) {
      console.log(`  Upserting ${aliasSynonyms.length} alias synonyms...`);
      await upsertOneWaySynonyms(tsClient, PERSONS_COLLECTION, aliasSynonyms);
    }
    console.log("Synonyms configured for persons collection.");
  }

  const startTime = Date.now();
  const { rows } = await pool.query<RawPersonRow>(
    `SELECT id, name, aliases, role, description, occupation, category FROM persons ORDER BY id ASC`,
  );

  const docs = rows.map((row) => ({
    id: `person_${row.id}`,
    pg_id: row.id,
    name: row.name,
    aliases: row.aliases ?? undefined,
    role: row.role,
    description: (row.description || "").slice(0, 10_000),
    occupation: row.occupation ?? undefined,
    category: row.category,
  }));

  let indexed = 0;
  let failed = 0;

  if (!dryRun && docs.length > 0) {
    const results = await tsClient
      .collections(PERSONS_COLLECTION)
      .documents()
      .import(docs, { action: "upsert" });

    const failures = results.filter((r) => !r.success);
    failed = failures.length;
    indexed = docs.length - failures.length;

    if (failures.length > 0) {
      console.warn(`  ${failures.length} failures`);
      for (const f of failures.slice(0, 3)) {
        console.warn(`    Error: ${(f as any).error}`);
      }
    }
  } else {
    indexed = docs.length;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone!`);
  console.log(`  Indexed: ${indexed.toLocaleString()}`);
  console.log(`  Failed:  ${failed.toLocaleString()}`);
  console.log(`  Time:    ${elapsed}s`);

  return failed;
}

async function indexDocumentPages(
  pool: pg.Pool,
  tsClient: InstanceType<typeof Typesense.Client>,
  startFrom: number,
  dryRun: boolean,
  r2Configured: boolean,
) {
  // Drop and recreate collection (unless resuming)
  if (startFrom === 0 && !dryRun) {
    try {
      await tsClient.collections(COLLECTION_NAME).delete();
      console.log(`Dropped existing collection: ${COLLECTION_NAME}`);
    } catch {
      // Collection may not exist
    }
    await tsClient.collections().create(COLLECTION_SCHEMA);
    console.log(`Created collection: ${COLLECTION_NAME}`);

    // Upsert static synonyms
    console.log("Upserting synonyms for document_pages...");
    await upsertSynonyms(tsClient, COLLECTION_NAME, DOCUMENT_PAGE_SYNONYMS);

    // Upsert alias-based one-way synonyms from persons table
    console.log("Building alias-based synonyms from persons table...");
    const { rows: aliasRows } = await pool.query<{ id: number; name: string; aliases: string[] | null }>(
      `SELECT id, name, aliases FROM persons WHERE aliases IS NOT NULL AND array_length(aliases, 1) > 0`,
    );
    const aliasSynonyms = buildAliasSynonyms(aliasRows);
    if (aliasSynonyms.length > 0) {
      console.log(`  Upserting ${aliasSynonyms.length} alias synonyms...`);
      await upsertOneWaySynonyms(tsClient, COLLECTION_NAME, aliasSynonyms);
    }
    console.log("Synonyms configured for document_pages collection.");
  }

  // Stream pages from PostgreSQL
  const startTime = Date.now();
  let cursor = startFrom;
  let indexed = 0;
  let failed = 0;
  let lastLogAt = 0;

  const query = `
    SELECT dp.id, dp.document_id, dp.page_number, dp.content, dp.page_type,
           d.title, d.document_type, d.data_set, d.r2_key, d.file_size_bytes
    FROM document_pages dp
    JOIN documents d ON d.id = dp.document_id
    WHERE dp.id > $1
    ORDER BY dp.id ASC
    LIMIT $2
  `;

  while (true) {
    const { rows } = await pool.query<RawRow>(query, [cursor, BATCH_SIZE]);
    if (rows.length === 0) break;

    // Transform rows to Typesense documents
    const docs = rows.map((row) => ({
      id: `pg_${row.id}`,
      pg_id: row.id,
      document_id: row.document_id,
      page_number: row.page_number,
      content: (row.content || "").slice(0, 50_000), // cap extreme outliers
      title: row.title || "",
      document_type: row.document_type || "",
      data_set: row.data_set || undefined,
      page_type: row.page_type || undefined,
      is_viewable: isViewable(row, r2Configured),
    }));

    if (!dryRun) {
      // Bulk import via JSONL
      const results = await tsClient
        .collections(COLLECTION_NAME)
        .documents()
        .import(docs, { action: "upsert" });

      const failures = results.filter((r) => !r.success);
      failed += failures.length;
      indexed += docs.length - failures.length;

      if (failures.length > 0) {
        console.warn(
          `  ${failures.length} failures in batch starting at id=${cursor}`,
        );
        for (const f of failures.slice(0, 3)) {
          console.warn(`    Error: ${(f as any).error}`);
        }
      }
    } else {
      indexed += docs.length;
    }

    cursor = rows[rows.length - 1].id;

    // Progress logging
    if (indexed - lastLogAt >= LOG_EVERY) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (indexed / ((Date.now() - startTime) / 1000)).toFixed(0);
      console.log(
        `  ${indexed.toLocaleString()} indexed (cursor=${cursor}, ${rate}/s, ${elapsed}s elapsed)`,
      );
      lastLogAt = indexed;
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone!`);
  console.log(`  Indexed: ${indexed.toLocaleString()}`);
  console.log(`  Failed:  ${failed.toLocaleString()}`);
  console.log(`  Time:    ${totalElapsed}s`);

  return failed;
}

async function main() {
  const args = process.argv.slice(2);
  const startFrom = parseInt(
    args.find((a) => a.startsWith("--start-from="))?.split("=")[1] || "0",
  );
  const dryRun = args.includes("--dry-run");
  const collection = args.find((a) => a.startsWith("--collection="))?.split("=")[1];

  // Validate env
  const dbUrl = process.env.DATABASE_URL;
  const tsHost = process.env.TYPESENSE_HOST;
  const tsApiKey = process.env.TYPESENSE_API_KEY;

  if (!dbUrl) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
  }
  if (!tsHost || !tsApiKey) {
    console.error("Missing TYPESENSE_HOST or TYPESENSE_API_KEY");
    process.exit(1);
  }

  const r2Configured = !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );

  // Connect to PostgreSQL
  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
  console.log("Connected to PostgreSQL");

  // Connect to Typesense
  const tsClient = new Typesense.Client({
    nodes: [
      {
        host: tsHost,
        port: parseInt(process.env.TYPESENSE_PORT || "8108"),
        protocol: process.env.TYPESENSE_PROTOCOL || "http",
      },
    ],
    apiKey: tsApiKey,
    connectionTimeoutSeconds: 10,
  });

  // Health check
  const health = await tsClient.health.retrieve();
  console.log(`Typesense health: ${health.ok ? "OK" : "UNHEALTHY"}`);

  if (dryRun) {
    console.log("DRY RUN — will validate rows without writing to Typesense");
  }

  let failed: number;

  if (collection === "persons") {
    console.log("Indexing persons collection...");
    failed = await indexPersons(pool, tsClient, dryRun);
  } else {
    console.log("Indexing document_pages collection...");
    failed = await indexDocumentPages(pool, tsClient, startFrom, dryRun, r2Configured);
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
