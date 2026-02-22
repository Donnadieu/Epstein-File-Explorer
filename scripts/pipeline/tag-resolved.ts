/**
 * 1. Backfills efta_number for ALL documents by extracting from source_url
 * 2. Tags extension-resolved documents by matching source URLs from resolved.partial.csv
 * 3. Fixes document_type for extension-resolved docs based on actual file extension
 * 4. Backfills r2_key for extension-resolved docs that were uploaded but missing the key
 *
 * Usage: npx tsx scripts/pipeline/tag-resolved.ts
 *   Prod: npm run tag-resolved
 */
import "dotenv/config";
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
  // Temporarily raise statement timeout for bulk updates
  await db.execute(sql`SET statement_timeout = '300s'`);

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

  // --- Phase 3: Fix document_type based on actual file extension ---
  console.log("\n=== Phase 3: Fix document_type ===\n");

  const extToDocType: Record<string, string> = {
    mp4: "video", avi: "video", mov: "video", wmv: "video", "3gp": "video",
    jpg: "photograph", jpeg: "photograph", png: "photograph", gif: "photograph",
    mp3: "video", m4a: "video", ogg: "video", wav: "video",
    xls: "financial record", xlsx: "financial record", csv: "financial record",
    doc: "government record", docx: "government record", pdf: "government record",
    txt: "government record", ppt: "government record", zip: "government record",
    ole: "government record",
  };

  const extensionIdx = headers.indexOf("extension");

  // Group original_urls by their target document_type
  const urlsByDocType = new Map<string, string[]>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const origUrl = cols[origIdx];
    const ext = cols[extensionIdx]?.toLowerCase();
    if (!origUrl || !ext) continue;
    const targetType = extToDocType[ext] || "government record";
    if (!urlsByDocType.has(targetType)) urlsByDocType.set(targetType, []);
    urlsByDocType.get(targetType)!.push(origUrl);
  }

  let docTypeFixed = 0;
  for (const [targetType, typeUrls] of urlsByDocType) {
    // Batch in groups of 200
    for (let i = 0; i < typeUrls.length; i += BATCH) {
      const batch = typeUrls.slice(i, i + BATCH);
      const inList = sql.join(batch.map(u => sql`${u}`), sql`, `);
      const result = await db.execute(sql`
        UPDATE documents
        SET document_type = ${targetType}
        WHERE source_url IN (${inList})
          AND document_type != ${targetType}
      `);
      docTypeFixed += (result as any).rowCount ?? 0;
    }
    console.log(`  ${targetType}: ${typeUrls.length} URLs`);
  }

  console.log(`✅ Fixed document_type for ${docTypeFixed} documents`);

  // --- Phase 4: Backfill r2_key for extension-resolved docs ---
  console.log("\n=== Phase 4: Backfill r2_key ===\n");

  const [missingR2] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`${documents.tags} @> ARRAY['extension-resolved'] AND r2_key IS NULL AND source_url IS NOT NULL`);
  console.log(`Documents missing r2_key: ${missingR2.count}`);

  if (missingR2.count > 0) {
    // Derive r2_key from source_url: extract dataset ID and filename
    // source_url pattern: https://www.justice.gov/epstein/files/DataSet%20{N}/{filename}
    const r2Result = await db.execute(sql`
      UPDATE documents
      SET r2_key = 'data-set-' ||
        regexp_replace(
          (regexp_match(source_url, 'DataSet%20([0-9]+)'))[1],
          '^', ''
        ) || '/' ||
        regexp_replace(
          (regexp_match(source_url, '/([^/]+)$'))[1],
          '%20', ' ', 'g'
        )
      WHERE tags @> ARRAY['extension-resolved']
        AND r2_key IS NULL
        AND source_url IS NOT NULL
        AND source_url ~ 'DataSet%20[0-9]+'
    `);
    const r2Fixed = (r2Result as any).rowCount ?? 0;
    console.log(`✅ Backfilled r2_key for ${r2Fixed} documents`);
  }

  const [finalCount] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`${documents.tags} @> ARRAY['extension-resolved'] AND document_type = 'video' AND r2_key IS NOT NULL`);
  console.log(`\nFinal: ${finalCount.count} extension-resolved videos with r2_key (visible in sidebar)`);

  // Restore default timeout
  await db.execute(sql`SET statement_timeout = '30s'`);
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
