/**
 * One-time migration script: reads AI analysis JSON files from data/ai-analyzed/
 * and inserts them into the ai_analyses + ai_analysis_persons PostgreSQL tables.
 *
 * Idempotent — uses ON CONFLICT DO UPDATE so it can be re-run safely.
 *
 * Usage: npx tsx scripts/pipeline/migrate-ai-to-db.ts
 */

import fs from "fs";
import path from "path";
import { db } from "../../server/db";
import { pool } from "../../server/db";
import { aiAnalyses, aiAnalysisPersons } from "../../shared/schema";
import { normalizeName } from "../../server/storage";
import { eq } from "drizzle-orm";

const AI_DIR = path.resolve(process.cwd(), "data", "ai-analyzed");
const BATCH_SIZE = 100;

interface RawAnalysis {
  fileName?: string;
  dataSet?: string;
  documentType?: string;
  dateOriginal?: string | null;
  summary?: string;
  persons?: { name: string; role?: string; category?: string; context?: string; mentionCount?: number }[];
  connections?: any[];
  events?: any[];
  locations?: (string | { location?: string; name?: string })[];
  keyFacts?: string[];
  tier?: number;
  costCents?: number;
  inputTokens?: number;
  outputTokens?: number;
  analyzedAt?: string;
}

function normalizeLocations(locations: RawAnalysis["locations"]): string[] {
  if (!Array.isArray(locations)) return [];
  return locations.map(loc => {
    if (typeof loc === "string") return loc;
    return (loc as any).location ?? (loc as any).name ?? "";
  }).filter(Boolean);
}

async function main() {
  console.log(`Reading JSON files from ${AI_DIR}...`);

  let entries: string[];
  try {
    entries = fs.readdirSync(AI_DIR).filter(f => f.endsWith(".json"));
  } catch (err) {
    console.error(`Cannot read directory: ${AI_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${entries.length} JSON files to migrate.`);

  let inserted = 0;
  let personRows = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    await db.transaction(async (tx) => {
      for (const file of batch) {
        try {
          const raw = fs.readFileSync(path.join(AI_DIR, file), "utf-8");
          const data: RawAnalysis = JSON.parse(raw);

          // The fileName stored in DB is without .json extension (e.g. "EFTA00000019.pdf")
          const fileName = data.fileName ?? file.replace(/\.json$/, "");
          const normalizedLocs = normalizeLocations(data.locations);

          const [row] = await tx.insert(aiAnalyses).values({
            fileName,
            dataSet: data.dataSet ?? null,
            documentType: data.documentType ?? null,
            dateOriginal: data.dateOriginal ?? null,
            summary: data.summary ?? null,
            personCount: Array.isArray(data.persons) ? data.persons.length : 0,
            connectionCount: Array.isArray(data.connections) ? data.connections.length : 0,
            eventCount: Array.isArray(data.events) ? data.events.length : 0,
            locationCount: normalizedLocs.length,
            keyFactCount: Array.isArray(data.keyFacts) ? data.keyFacts.length : 0,
            tier: data.tier ?? 0,
            costCents: data.costCents ?? 0,
            inputTokens: data.inputTokens ?? 0,
            outputTokens: data.outputTokens ?? 0,
            persons: data.persons ?? [],
            connectionsData: data.connections ?? [],
            events: data.events ?? [],
            locations: normalizedLocs,
            keyFacts: data.keyFacts ?? [],
            analyzedAt: data.analyzedAt ? new Date(data.analyzedAt) : null,
          }).onConflictDoUpdate({
            target: aiAnalyses.fileName,
            set: {
              dataSet: data.dataSet ?? null,
              documentType: data.documentType ?? null,
              dateOriginal: data.dateOriginal ?? null,
              summary: data.summary ?? null,
              personCount: Array.isArray(data.persons) ? data.persons.length : 0,
              connectionCount: Array.isArray(data.connections) ? data.connections.length : 0,
              eventCount: Array.isArray(data.events) ? data.events.length : 0,
              locationCount: normalizedLocs.length,
              keyFactCount: Array.isArray(data.keyFacts) ? data.keyFacts.length : 0,
              tier: data.tier ?? 0,
              costCents: data.costCents ?? 0,
              inputTokens: data.inputTokens ?? 0,
              outputTokens: data.outputTokens ?? 0,
              persons: data.persons ?? [],
              connectionsData: data.connections ?? [],
              events: data.events ?? [],
              locations: normalizedLocs,
              keyFacts: data.keyFacts ?? [],
              analyzedAt: data.analyzedAt ? new Date(data.analyzedAt) : null,
            },
          }).returning({ id: aiAnalyses.id });

          // Delete existing person rows for this analysis (upsert pattern)
          await tx.delete(aiAnalysisPersons).where(eq(aiAnalysisPersons.aiAnalysisId, row.id));

          // Insert person rows
          if (Array.isArray(data.persons) && data.persons.length > 0) {
            await tx.insert(aiAnalysisPersons).values(
              data.persons.map(p => ({
                aiAnalysisId: row.id,
                name: p.name,
                normalizedName: normalizeName(p.name),
                role: p.role ?? null,
                category: p.category ?? null,
                context: p.context ?? null,
                mentionCount: p.mentionCount ?? 1,
              }))
            );
            personRows += data.persons.length;
          }

          inserted++;
        } catch (err) {
          console.error(`  Error processing ${file}: ${(err as Error).message}`);
          errors++;
        }
      }
    });

    if ((i + BATCH_SIZE) % 500 < BATCH_SIZE || i + BATCH_SIZE >= entries.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length} files (${elapsed}s elapsed)`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nMigration complete in ${totalTime}s:`);
  console.log(`  Analyses inserted/updated: ${inserted}`);
  console.log(`  Person rows inserted: ${personRows}`);
  console.log(`  Errors: ${errors}`);

  await pool.end();
}

main().catch(err => {
  console.error("Migration failed:", err);
  pool.end().then(() => process.exit(1));
});
