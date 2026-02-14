import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { documents, documentPages } from "../../shared/schema";
import { sql } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTRACTED_DIR = path.resolve(__dirname, "../../data/extracted");
const BATCH_SIZE = 500;
const MIN_CONTENT_LENGTH = 20;

interface ExtractedDocument {
  fileName: string;
  dataSetId: number;
  text: string;
  pageCount: number;
}

async function buildEftaLookup(): Promise<Map<string, number>> {
  console.log("Building eftaNumber → documentId lookup...");
  const rows = await db.select({
    id: documents.id,
    eftaNumber: documents.eftaNumber,
    title: documents.title,
  }).from(documents);

  const lookup = new Map<string, number>();
  for (const row of rows) {
    // Primary: use eftaNumber field
    if (row.eftaNumber) {
      lookup.set(row.eftaNumber, row.id);
    }
    // Fallback: parse EFTA number from title
    const match = row.title.match(/^([A-Z]{2,6}[-_]?\d{4,})/i);
    if (match && !lookup.has(match[1])) {
      lookup.set(match[1], row.id);
    }
  }
  console.log(`  Loaded ${lookup.size} mappings from ${rows.length} documents`);
  return lookup;
}

function splitPages(text: string): string[] {
  // pdf-processor.ts joins each page's text with \n\n
  return text.split("\n\n").filter(p => p.trim().length >= MIN_CONTENT_LENGTH);
}

async function loadPages() {
  console.log("\n=== Document Page Loader ===\n");

  if (!fs.existsSync(EXTRACTED_DIR)) {
    console.log(`No extracted data at ${EXTRACTED_DIR}. Run pdf-processor.ts first.`);
    return;
  }

  const eftaLookup = await buildEftaLookup();

  const dsDirs = fs.readdirSync(EXTRACTED_DIR)
    .filter(d => d.startsWith("ds") && fs.statSync(path.join(EXTRACTED_DIR, d)).isDirectory())
    .sort();

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFiles = 0;
  const batch: { documentId: number; pageNumber: number; content: string }[] = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    await db.insert(documentPages).values(batch).onConflictDoNothing();
    totalInserted += batch.length;
    batch.length = 0;
  }

  for (const dsDir of dsDirs) {
    const dsPath = path.join(EXTRACTED_DIR, dsDir);
    const jsonFiles = fs.readdirSync(dsPath).filter(f => f.endsWith(".json"));
    console.log(`  ${dsDir}: ${jsonFiles.length} files`);

    for (const file of jsonFiles) {
      totalFiles++;
      try {
        const raw = fs.readFileSync(path.join(dsPath, file), "utf-8");
        const doc: ExtractedDocument = JSON.parse(raw);

        // Derive EFTA number from filename (e.g., "EFTA00000019.json" → "EFTA00000019")
        const eftaNumber = path.basename(file, ".json");
        const documentId = eftaLookup.get(eftaNumber);

        if (!documentId) {
          totalSkipped++;
          continue;
        }

        const pages = splitPages(doc.text);
        for (let i = 0; i < pages.length; i++) {
          batch.push({
            documentId,
            pageNumber: i + 1,
            content: pages[i],
          });

          if (batch.length >= BATCH_SIZE) {
            await flushBatch();
          }
        }
      } catch (err: any) {
        console.warn(`  Error processing ${file}: ${err.message}`);
      }

      if (totalFiles % 1000 === 0) {
        await flushBatch();
        console.log(`  Progress: ${totalFiles} files, ${totalInserted} pages inserted, ${totalSkipped} skipped`);
      }
    }
  }

  // Flush remaining
  await flushBatch();

  console.log("\n=== Load Summary ===");
  console.log(`Files processed: ${totalFiles}`);
  console.log(`Pages inserted: ${totalInserted}`);
  console.log(`Files skipped (no document match): ${totalSkipped}`);
}

loadPages()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
