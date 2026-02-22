/**
 * Tags existing documents in the database with "extension-resolved"
 * by matching EFTA IDs from resolved.partial.csv.
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

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  // Load EFTA IDs from CSV
  const lines = fs.readFileSync(CSV_PATH, "utf-8").split("\n");
  const eftaIds: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const firstComma = lines[i].indexOf(",");
    if (firstComma > 0) eftaIds.push(lines[i].substring(0, firstComma));
  }
  console.log(`Loaded ${eftaIds.length} EFTA IDs from CSV`);

  // Check how many already have the tag
  const [before] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`${documents.tags} @> ARRAY['extension-resolved']`);
  console.log(`Already tagged: ${before.count}`);

  // Update in batches of 500
  const BATCH = 500;
  let tagged = 0;
  for (let i = 0; i < eftaIds.length; i += BATCH) {
    const batch = eftaIds.slice(i, i + BATCH);
    const result = await db.execute(sql`
      UPDATE documents
      SET tags = array_append(
        COALESCE(array_remove(tags, 'extension-resolved'), ARRAY[]::text[]),
        'extension-resolved'
      )
      WHERE efta_number = ANY(${batch})
        AND (tags IS NULL OR NOT tags @> ARRAY['extension-resolved'])
    `);
    tagged += (result as any).rowCount ?? 0;
    process.stdout.write(`\r  Tagged ${tagged} documents (batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(eftaIds.length / BATCH)})`);
  }

  console.log(`\n\n✅ Tagged ${tagged} documents with "extension-resolved"`);

  // Verify
  const [after] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(documents).where(sql`${documents.tags} @> ARRAY['extension-resolved']`);
  console.log(`Total with tag: ${after.count}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
