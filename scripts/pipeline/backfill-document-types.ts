import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { documents } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AI_ANALYZED_DIR = path.resolve(__dirname, "../../data/ai-analyzed");

/**
 * Canonical document type mapping.
 * Each entry maps a canonical type to regex patterns that match AI-assigned document types.
 */
const CANONICAL_TYPE_MAP: [string, RegExp][] = [
  ["correspondence", /correspondence|email|letter|memo|fax|internal memorandum/i],
  ["court filing", /court filing|court order|indictment|plea|subpoena|motion|docket/i],
  ["fbi report", /fbi|302|bureau/i],
  ["deposition", /deposition|interview transcript/i],
  ["grand jury transcript", /grand jury/i],
  ["flight log", /flight|manifest|aircraft/i],
  ["financial record", /financial|bank|account|employment record/i],
  ["search warrant", /search warrant|seizure|elsur/i],
  ["police report", /police|incident report|booking/i],
  ["property record", /property|real estate/i],
  ["news article", /news|press|article|magazine/i],
  ["travel record", /travel|passport|immigration/i],
];

function normalizeDocumentType(aiType: string): string {
  for (const [canonical, pattern] of CANONICAL_TYPE_MAP) {
    if (pattern.test(aiType)) return canonical;
  }
  return "government record";
}

function parseEftaNumber(fileName: string): string | null {
  const match = fileName.match(/(EFTA\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

interface AIAnalysis {
  fileName?: string;
  documentType?: string;
}

async function main() {
  console.log("Reading AI-analyzed files...");

  let entries: string[];
  try {
    entries = fs.readdirSync(AI_ANALYZED_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`Cannot read directory: ${AI_ANALYZED_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${entries.length} AI analysis files`);

  const updates: { eftaNumber: string; canonicalType: string }[] = [];
  const typeCounts = new Map<string, number>();

  for (const file of entries) {
    try {
      const raw = fs.readFileSync(path.join(AI_ANALYZED_DIR, file), "utf-8");
      const data: AIAnalysis = JSON.parse(raw);

      const eftaNumber = parseEftaNumber(file);
      if (!eftaNumber) continue;

      const aiType = data.documentType || "";
      const canonical = normalizeDocumentType(aiType);

      // Only queue updates for rows that would actually change
      if (canonical !== "government record") {
        updates.push({ eftaNumber, canonicalType: canonical });
      }

      typeCounts.set(canonical, (typeCounts.get(canonical) || 0) + 1);
    } catch {
      console.warn(`Skipping invalid file: ${file}`);
    }
  }

  console.log("\nType distribution from AI analysis:");
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log(`\n${updates.length} documents to update (excluding 'government record' fallbacks)`);

  // Batch update in chunks of 100
  const BATCH_SIZE = 100;
  let updated = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    for (const { eftaNumber, canonicalType } of batch) {
      const result = await db
        .update(documents)
        .set({ documentType: canonicalType })
        .where(
          and(
            eq(documents.eftaNumber, eftaNumber),
            eq(documents.documentType, "government record"),
          ),
        )
        .returning({ id: documents.id });

      updated += result.length;
    }

    console.log(`  Processed ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length} updates (${updated} rows changed)`);
  }

  console.log(`\nDone. Updated ${updated} document rows.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
