/**
 * 1. Backfills efta_number for ALL documents by extracting from source_url
 * 2. Tags extension-resolved documents by matching source URLs from resolved.partial.csv
 *
 * Usage: npx tsx scripts/pipeline/tag-resolved.ts
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { documents } from "../../shared/schema";
import { sql } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const CSV_PATH = path.join(DATA_DIR, "resolved.partial.csv");

export async function tagResolved() {
  // --- Phase 1: Backfill efta_number from source_url ---
  console.log("=== Phase 1: Backfill efta_number ===\n");

  const [missing] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`efta_number IS NULL AND source_url IS NOT NULL`);
  console.log(`Documents missing efta_number: ${missing.count}`);

  if (missing.count > 0) {
    // Batch by ID ranges to avoid statement timeout on 1.3M rows
    const EFTA_BATCH = 50000;
    let backfilled = 0;

    // Get ID range
    const [range] = await db.select({
      minId: sql<number>`min(id)::int`,
      maxId: sql<number>`max(id)::int`,
    }).from(documents).where(sql`efta_number IS NULL AND source_url IS NOT NULL AND source_url ~ 'EFTA[0-9]+'`);

    if (range.minId != null) {
      for (let startId = range.minId; startId <= range.maxId; startId += EFTA_BATCH) {
        const endId = startId + EFTA_BATCH;
        const result = await db.execute(sql`
          UPDATE documents
          SET efta_number = (regexp_match(source_url, '(EFTA[0-9]+)'))[1]
          WHERE id >= ${startId} AND id < ${endId}
            AND efta_number IS NULL
            AND source_url IS NOT NULL
            AND source_url ~ 'EFTA[0-9]+'
        `);
        backfilled += (result as any).rowCount ?? 0;
        process.stdout.write(`\r  Backfilled ${backfilled} (ids ${startId}-${endId})`);
      }
    }

    console.log(`\n✅ Backfilled efta_number for ${backfilled} documents`);
  }

  const [total] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`efta_number IS NOT NULL`);
  console.log(`Total with efta_number: ${total.count}\n`);

  // --- Phase 2: Tag extension-resolved documents ---
  console.log("=== Phase 2: Tag extension-resolved ===\n");

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = content.split("\n");
  const headers = lines[0].split(",");
  const origIdx = headers.indexOf("original_url");
  const resolvedIdx = headers.indexOf("resolved_url");

  const urls: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[origIdx]) urls.push(cols[origIdx]);
    if (cols[resolvedIdx] && cols[resolvedIdx] !== cols[origIdx]) {
      urls.push(cols[resolvedIdx]);
    }
  }
  console.log(`Loaded ${urls.length} URLs to match (original + resolved)`);

  const [before] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`${documents.tags} @> ARRAY['extension-resolved']`);
  console.log(`Already tagged: ${before.count}`);

  const BATCH = 200;
  let tagged = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    const inList = sql.join(batch.map(u => sql`${u}`), sql`, `);
    const result = await db.execute(sql`
      UPDATE documents
      SET tags = array_append(
        COALESCE(array_remove(tags, 'extension-resolved'), ARRAY[]::text[]),
        'extension-resolved'
      )
      WHERE source_url IN (${inList})
        AND (tags IS NULL OR NOT tags @> ARRAY['extension-resolved'])
    `);
    tagged += (result as any).rowCount ?? 0;
    process.stdout.write(`\r  Tagged ${tagged} documents (batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(urls.length / BATCH)})`);
  }

  console.log(`\n\n✅ Tagged ${tagged} documents with "extension-resolved"`);

  const [after] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`${documents.tags} @> ARRAY['extension-resolved']`);
  console.log(`Total with tag: ${after.count}`);

}

// Allow direct execution
if (process.argv[1]?.includes("tag-resolved")) {
  tagResolved()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Failed:", err);
      process.exit(1);
    });
}
