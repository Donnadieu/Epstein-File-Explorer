import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { eq, and } from "drizzle-orm";
import { db } from "../../server/db";
import { aiAnalyses } from "../../shared/schema";
import { getClient, getModelConfig, calculateCostCents } from "../../server/chat/models";
import { chunkText, type AIEntityMention, type AIConnection } from "./ai-analyzer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const MAX_CHUNK_CHARS = 24000;
const MIN_TEXT_LENGTH = 200;

// --- Entity-only extraction prompt (much shorter than full analysis) ---

const ENTITY_EXTRACTION_PROMPT = `You are an expert analyst extracting entity information from Epstein case documents.

Extract ONLY:

1. ENTITIES: Organizations, companies, financial institutions, properties, vehicles, and other non-person entities mentioned:
   - name: Entity name as it appears
   - entityType: One of: financial_institution, shell_company, law_firm, property, aircraft, vessel, government_agency, media_outlet, educational_institution, other_organization
   - context: 1-2 sentence summary of how this entity relates to the case or document
   - attributes: Key-value pairs of notable details (e.g., {"address": "9 East 71st Street", "tail_number": "N908JE"})
   - confidence: 0.0-1.0

2. ENTITY CONNECTIONS: Relationships where at least one side is an entity (not person-to-person):
   - person1: Name of first person or entity
   - person2: Name of second person or entity
   - entity1Type: Type if person1 is an entity (e.g., "financial_institution"), omit or "person" if it's a person
   - entity2Type: Type if person2 is an entity, omit or "person" if it's a person
   - relationshipType: e.g., "financial-client", "employer-employee", "owner", "board-member", "financial-transaction"
   - description: Brief description of the relationship
   - strength: 1-5

RULES:
- Only extract non-person entities (organizations, companies, properties, vehicles, etc.)
- Do NOT include person names as entities
- For connections, at least one side must be an entity
- If the text is too garbled to analyze, return empty arrays

Respond with valid JSON only:
{
  "entities": [...],
  "entityConnections": [...]
}`;

// --- Interfaces ---

interface BackfillConfig {
  budget?: number;
  limit?: number;
  dryRun: boolean;
  model?: string;
  delayMs: number;
}

interface BackfillResult {
  entities: AIEntityMention[];
  entityConnections: AIConnection[];
}

interface BackfillProgress {
  processed: number;
  skippedNoText: number;
  errors: number;
  totalEntities: number;
  totalConnections: number;
  totalCostCents: number;
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadDocumentText(fileName: string, dataSet: string): string | null {
  // Determine ds directory from dataSet (e.g., "Data Set 1" → "ds1", or just "1" → "ds1")
  const dsMatch = dataSet.match(/(\d+)/);
  if (!dsMatch) return null;
  const dsDir = path.join(EXTRACTED_DIR, `ds${dsMatch[1]}`);
  if (!fs.existsSync(dsDir)) return null;

  const base = fileName.replace(/\.pdf$/i, "").replace(/\.json$/i, "");

  // Try exact match first
  const exactPath = path.join(dsDir, `${base}.json`);
  if (fs.existsSync(exactPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(exactPath, "utf-8"));
      return data.text && data.text.length >= MIN_TEXT_LENGTH ? data.text : null;
    } catch { return null; }
  }

  // Fallback: scan directory for partial match
  try {
    const entries = fs.readdirSync(dsDir);
    for (const entry of entries) {
      if (entry.startsWith(base) && entry.endsWith(".json")) {
        const data = JSON.parse(fs.readFileSync(path.join(dsDir, entry), "utf-8"));
        return data.text && data.text.length >= MIN_TEXT_LENGTH ? data.text : null;
      }
    }
  } catch { /* fall through */ }
  return null;
}

async function extractEntitiesFromChunk(
  text: string,
  fileName: string,
  dataSet: string,
  modelId?: string,
): Promise<{ result: BackfillResult; inputTokens: number; outputTokens: number }> {
  const client = getClient(modelId);
  const config = getModelConfig(modelId);

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: ENTITY_EXTRACTION_PROMPT },
      {
        role: "user",
        content: `Extract entities from this Epstein case document. File: ${fileName}, Data Set: ${dataSet}\n\n---\n${text}`,
      },
    ],
    max_tokens: 2048,
    temperature: 0.1,
  });

  const usage = response.usage;
  const inTok = usage?.prompt_tokens ?? 0;
  const outTok = usage?.completion_tokens ?? 0;
  const empty = { result: { entities: [], entityConnections: [] }, inputTokens: inTok, outputTokens: outTok };

  let content = response.choices[0]?.message?.content;
  if (!content) return empty;

  content = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { return empty; }
    } else {
      return empty;
    }
  }

  return {
    result: {
      entities: (parsed.entities || []).filter((e: any) => e.name && e.name.length > 1),
      entityConnections: (parsed.entityConnections || []).filter(
        (c: any) => c.person1 && c.person2 &&
        ((c.entity1Type && c.entity1Type !== "person") || (c.entity2Type && c.entity2Type !== "person"))
      ),
    },
    inputTokens: inTok,
    outputTokens: outTok,
  };
}

function mergeEntityResults(results: BackfillResult[]): BackfillResult {
  if (results.length === 1) return results[0];

  const entityMap = new Map<string, AIEntityMention>();
  const connSet = new Set<string>();
  const mergedConns: AIConnection[] = [];

  for (const r of results) {
    for (const ent of r.entities) {
      const key = `${ent.name.toLowerCase()}|${ent.entityType}`;
      if (entityMap.has(key)) {
        const existing = entityMap.get(key)!;
        if (ent.context.length > existing.context.length) existing.context = ent.context;
        if (ent.attributes) existing.attributes = { ...existing.attributes, ...ent.attributes };
        if (ent.confidence != null && (existing.confidence == null || ent.confidence > existing.confidence))
          existing.confidence = ent.confidence;
      } else {
        entityMap.set(key, { ...ent });
      }
    }
    for (const conn of r.entityConnections) {
      const key = [conn.person1, conn.person2].sort().join("|") + "|" + conn.relationshipType;
      if (!connSet.has(key)) {
        connSet.add(key);
        mergedConns.push(conn);
      }
    }
  }

  return { entities: Array.from(entityMap.values()), entityConnections: mergedConns };
}

// --- Main backfill function ---

export async function backfillEntities(config: BackfillConfig): Promise<BackfillProgress> {
  const progress: BackfillProgress = {
    processed: 0, skippedNoText: 0, errors: 0,
    totalEntities: 0, totalConnections: 0, totalCostCents: 0,
  };

  const modelConfig = getModelConfig(config.model);
  console.log(`\n=== Entity Backfill ===`);
  console.log(`Model: ${modelConfig.label}`);
  console.log(`Budget: ${config.budget ? `${config.budget} cents ($${(config.budget / 100).toFixed(2)})` : "unlimited"}`);
  console.log(`Limit: ${config.limit ?? "none"}`);
  if (config.dryRun) console.log("MODE: DRY RUN");

  // Query v1 analyses (tier 1 only -- tier 0 uses keyword extraction, no source text)
  const v1Rows = await db.select({
    id: aiAnalyses.id,
    fileName: aiAnalyses.fileName,
    dataSet: aiAnalyses.dataSet,
    connectionsData: aiAnalyses.connectionsData,
  }).from(aiAnalyses)
    .where(and(
      eq(aiAnalyses.schemaVersion, 1),
      eq(aiAnalyses.tier, 1),
    ));

  console.log(`Found ${v1Rows.length} v1 analyses to backfill`);

  const toProcess = config.limit ? v1Rows.slice(0, config.limit) : v1Rows;

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i];

    // Budget check
    if (config.budget && progress.totalCostCents >= config.budget) {
      console.log(`\n  Budget cap reached: ${progress.totalCostCents.toFixed(2)} / ${config.budget} cents`);
      break;
    }

    // Load source text
    const text = loadDocumentText(row.fileName, row.dataSet || "unknown");
    if (!text) {
      progress.skippedNoText++;
      continue;
    }

    if (config.dryRun) {
      progress.processed++;
      if (progress.processed <= 10 || progress.processed % 1000 === 0) {
        console.log(`  [DRY RUN] Would process ${row.fileName} (${text.length} chars)`);
      }
      continue;
    }

    try {
      const chunks = chunkText(text, MAX_CHUNK_CHARS);
      const chunkResults: { result: BackfillResult; inputTokens: number; outputTokens: number }[] = [];

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunkResult = await extractEntitiesFromChunk(
          chunks[ci], row.fileName, row.dataSet || "unknown", config.model
        );
        chunkResults.push(chunkResult);

        if (chunks.length > 1 && ci < chunks.length - 1) {
          await sleep(500);
        }
      }

      const totalInput = chunkResults.reduce((s, c) => s + c.inputTokens, 0);
      const totalOutput = chunkResults.reduce((s, c) => s + c.outputTokens, 0);
      const costCents = calculateCostCents(totalInput, totalOutput, config.model);
      progress.totalCostCents += costCents;

      const merged = mergeEntityResults(chunkResults.map(c => c.result));

      // Update ai_analyses: set entities, append entity-connections, bump schemaVersion
      const existingConns = (row.connectionsData as any[]) || [];
      const enrichedConns = [...existingConns, ...merged.entityConnections];

      await db.update(aiAnalyses).set({
        entities: merged.entities,
        entityCount: merged.entities.length,
        connectionsData: enrichedConns,
        connectionCount: enrichedConns.length,
        schemaVersion: 2,
      }).where(eq(aiAnalyses.id, row.id));

      progress.processed++;
      progress.totalEntities += merged.entities.length;
      progress.totalConnections += merged.entityConnections.length;

      if (progress.processed % 50 === 0 || i === toProcess.length - 1) {
        console.log(`  [${progress.processed}/${toProcess.length}] ${row.fileName}: ${merged.entities.length} entities, ${merged.entityConnections.length} conns [${costCents.toFixed(3)}c, total: ${progress.totalCostCents.toFixed(2)}c]`);
      }

      if (i < toProcess.length - 1) {
        await sleep(config.delayMs);
      }
    } catch (error: any) {
      console.error(`  Error processing ${row.fileName}: ${error.message}`);
      progress.errors++;
      if (error.message?.includes("429") || error.status === 429) {
        console.log("  Rate limited, waiting 30s...");
        await sleep(30000);
        i--; // Retry this row
      }
    }
  }

  // Summary
  console.log(`\n=== Backfill Summary ===`);
  console.log(`Processed: ${progress.processed}`);
  console.log(`Entities extracted: ${progress.totalEntities}`);
  console.log(`Entity connections extracted: ${progress.totalConnections}`);
  console.log(`Skipped (no text): ${progress.skippedNoText}`);
  console.log(`Errors: ${progress.errors}`);
  console.log(`Total cost: ${progress.totalCostCents.toFixed(2)} cents ($${(progress.totalCostCents / 100).toFixed(4)})`);

  return progress;
}

// --- CLI entry point ---

if (process.argv[1]?.includes("backfill-entities")) {
  const args = process.argv.slice(2);
  const config: BackfillConfig = {
    dryRun: false,
    delayMs: 1500,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--budget" && args[i + 1]) config.budget = parseInt(args[++i], 10);
    else if (args[i] === "--limit" && args[i + 1]) config.limit = parseInt(args[++i], 10);
    else if (args[i] === "--dry-run") config.dryRun = true;
    else if (args[i] === "--model" && args[i + 1]) config.model = args[++i];
    else if (args[i] === "--delay" && args[i + 1]) config.delayMs = parseInt(args[++i], 10);
  }

  backfillEntities(config)
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
