import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import {
  documents,
  documentPages,
  aiAnalyses,
  budgetTracking,
  aiAnalysisPersons,
} from "../../shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { analyzeDocumentTiered } from "./ai-analyzer";
import { normalizeName } from "../../server/storage";
import { getModelConfig } from "../../server/chat/models";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const AI_OUTPUT_DIR = path.join(DATA_DIR, "ai-analyzed");

// --- Scoring weights ---

const WEIGHTS = {
  textLength: 0.25,
  personMentions: 0.30,
  documentType: 0.25,
  dataSet: 0.20,
};

// Document types scored by investigative value
const DOC_TYPE_SCORES: Record<string, number> = {
  "deposition": 100,
  "grand jury transcript": 95,
  "financial record": 85,
  "fbi report": 80,
  "email": 75,
  "flight log": 70,
  "search warrant": 65,
  "police report": 60,
  "court filing": 55,
  "contact list": 50,
  "property record": 45,
  "correspondence": 40,
  "travel record": 35,
  "news article": 20,
  "photograph": 5,
  "video": 5,
  "government record": 30,
};

// Data set priority (same as batch-processor.ts)
const DATASET_SCORES: Record<string, number> = {
  "9": 100,   // Private emails, DOJ NPA documents
  "1": 80,    // FBI files, flight logs, contact books
  "5": 60,    // Grand jury transcripts, SDNY investigation
  "2": 40,    // FBI 302 interview reports
  "3": 35,    // Victim statements, witness interviews
  "4": 30,    // FBI Form 302 summaries
  "6": 25,    // Search warrants, property inventories
  "7": 20,    // Financial records
  "8": 15,    // Surveillance footage, MCC records
  "11": 10,   // Financial ledgers, additional manifests
  "12": 5,    // Supplemental late productions
  "10": 1,    // Visual/forensic media
};

// Known persons from Tier 0 — used for scoring unanalyzed docs
const KNOWN_PERSONS: string[] = [
  "jeffrey epstein", "ghislaine maxwell", "virginia giuffre", "virginia roberts",
  "prince andrew", "alan dershowitz", "jean-luc brunel", "sarah kellen",
  "les wexner", "alexander acosta", "bill clinton", "donald trump",
  "nadia marcinkova", "johanna sjoberg", "adriana ross", "lesley groff",
  "bill gates", "bill richardson", "george mitchell", "ehud barak",
  "leon black", "glenn dubin", "eva andersson-dubin", "larry summers",
  "naomi campbell", "kevin spacey", "david copperfield", "woody allen",
  "reid hoffman", "sergey brin", "richard branson", "peter mandelson",
  "sarah ferguson", "steve bannon", "peter attia", "marvin minsky",
  "lawrence krauss", "stephen hawking", "leon botstein", "katie couric",
  "martha stewart", "chris tucker",
];

// Pre-compile person patterns for fast matching
const PERSON_PATTERNS = KNOWN_PERSONS.map(name => ({
  name,
  regex: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
}));

// Document type inference patterns (same as ai-analyzer.ts Tier 0)
const DOC_TYPE_PATTERNS: [RegExp, string][] = [
  [/flight\s+log|manifest|passenger|aircraft|tail\s+number|teterboro/i, "flight log"],
  [/deposition|testimony|sworn|under\s+oath|direct\s+examination|cross.?examination/i, "deposition"],
  [/grand\s+jury|indictment|true\s+bill|presentment/i, "grand jury transcript"],
  [/search\s+warrant|inventory|seized|raid/i, "search warrant"],
  [/fbi|302|investigation|bureau|special\s+agent/i, "fbi report"],
  [/email|correspondence|from:\s*\S|to:\s*\S|subject:\s*\S/i, "email"],
  [/court|filing|motion|order|docket|plea/i, "court filing"],
  [/financial|bank|wire\s+transfer|account|transaction/i, "financial record"],
  [/contact|address\s+book|phone\s+number|rolodex/i, "contact list"],
  [/property|real\s+estate|island|little\s+st/i, "property record"],
  [/police|report|incident|complaint/i, "police report"],
];

interface ScoredDocument {
  id: number;
  title: string;
  eftaNumber: string | null;
  dataSet: string | null;
  documentType: string;
  extractedTextLength: number | null;
  textSample: string;
  score: number;
  breakdown: {
    textLengthScore: number;
    personMentionScore: number;
    documentTypeScore: number;
    dataSetScore: number;
  };
  personMentionCount: number;
  inferredDocType: string;
  personsFound: string[];
}

interface ProcessConfig {
  limit: number;
  monthlyCapCents: number;
  dryRun: boolean;
  model?: string;
}

// --- Scoring functions ---

function scoreTextLength(length: number): number {
  // Log scale: 200 chars = ~0, 1000 = ~30, 5000 = ~60, 20000 = ~80, 100000 = ~100
  if (length < 200) return 0;
  return Math.min(100, Math.log10(length / 200) * 37);
}

function scorePersonMentions(count: number): number {
  // 0 = 0, 1 = 30, 2 = 50, 3 = 65, 5 = 80, 10+ = 100
  if (count === 0) return 0;
  return Math.min(100, 30 + (count - 1) * 15);
}

function scoreDocumentType(docType: string): number {
  return DOC_TYPE_SCORES[docType] ?? 30;
}

function scoreDataSet(dataSet: string | null): number {
  if (!dataSet) return 10;
  return DATASET_SCORES[dataSet] ?? 10;
}

function inferDocumentType(text: string): string {
  for (const [pattern, docType] of DOC_TYPE_PATTERNS) {
    if (pattern.test(text)) return docType;
  }
  return "government record";
}

function countPersonMentions(text: string): { count: number; names: string[] } {
  const textLower = text.toLowerCase();
  const found: string[] = [];
  let total = 0;

  for (const { name, regex } of PERSON_PATTERNS) {
    // Reset regex state
    regex.lastIndex = 0;
    const matches = textLower.match(regex);
    if (matches && matches.length > 0) {
      found.push(name);
      total += matches.length;
    }
  }

  return { count: found.length, names: found };
}

function computeScore(
  textLength: number,
  personMentionCount: number,
  docType: string,
  dataSet: string | null,
): { score: number; breakdown: ScoredDocument["breakdown"] } {
  const textLengthScore = scoreTextLength(textLength);
  const personMentionScore = scorePersonMentions(personMentionCount);
  const documentTypeScore = scoreDocumentType(docType);
  const dataSetScore = scoreDataSet(dataSet);

  const score =
    textLengthScore * WEIGHTS.textLength +
    personMentionScore * WEIGHTS.personMentions +
    documentTypeScore * WEIGHTS.documentType +
    dataSetScore * WEIGHTS.dataSet;

  return {
    score,
    breakdown: { textLengthScore, personMentionScore, documentTypeScore, dataSetScore },
  };
}

// --- Database queries ---

const BATCH_SIZE = 500;

async function findUnanalyzedWithText(): Promise<Array<{
  id: number;
  title: string;
  eftaNumber: string | null;
  dataSet: string | null;
  documentType: string;
  extractedTextLength: number | null;
}>> {
  // Documents with extracted text (length > 200) but aiAnalysisStatus still "pending"
  // and no matching row in ai_analyses
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      eftaNumber: documents.eftaNumber,
      dataSet: documents.dataSet,
      documentType: documents.documentType,
      extractedTextLength: documents.extractedTextLength,
    })
    .from(documents)
    .where(
      and(
        eq(documents.aiAnalysisStatus, "pending"),
        sql`${documents.extractedTextLength} > 200`,
      )
    );

  return rows;
}

async function getDocumentText(documentId: number, maxChars: number = 10000): Promise<string> {
  // Read from document_pages table, concatenating page content
  const pages = await db
    .select({ content: documentPages.content, pageNumber: documentPages.pageNumber })
    .from(documentPages)
    .where(eq(documentPages.documentId, documentId))
    .orderBy(documentPages.pageNumber);

  if (pages.length === 0) return "";

  let text = "";
  for (const page of pages) {
    text += page.content + "\n";
    if (text.length >= maxChars) break;
  }

  return text.slice(0, maxChars);
}

// --- Budget ---

async function getMonthlySpend(): Promise<number> {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const result = await db
    .select({
      totalCents: sql<number>`COALESCE(SUM(${budgetTracking.costCents}), 0)::int`,
    })
    .from(budgetTracking)
    .where(sql`${budgetTracking.date} >= ${monthStart}`);

  return result[0]?.totalCents ?? 0;
}

async function recordCost(
  documentId: number,
  costCents: number,
  inputTokens: number,
  outputTokens: number,
  modelId?: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const config = getModelConfig(modelId);

  await db.insert(budgetTracking).values({
    date: today,
    model: config.model,
    inputTokens,
    outputTokens,
    costCents: Math.round(costCents * 100) / 100,
    documentId,
    jobType: "high_value_analysis",
  });

  const existing = await db
    .select({ aiCostCents: documents.aiCostCents })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  const currentCost = existing[0]?.aiCostCents ?? 0;
  await db
    .update(documents)
    .set({ aiCostCents: currentCost + Math.ceil(costCents) })
    .where(eq(documents.id, documentId));
}

// --- Processing ---

async function processTopDocuments(
  ranked: ScoredDocument[],
  config: ProcessConfig,
): Promise<void> {
  const modelConfig = getModelConfig(config.model);
  const monthlySpent = await getMonthlySpend();
  let budgetRemaining = config.monthlyCapCents - monthlySpent;

  console.log(`\n=== Processing Top ${config.limit} High-Value Documents ===\n`);
  console.log(`Model: ${modelConfig.label} (${modelConfig.model})`);
  console.log(`Budget: $${(config.monthlyCapCents / 100).toFixed(2)} (spent: $${(monthlySpent / 100).toFixed(2)}, remaining: $${(budgetRemaining / 100).toFixed(2)})`);
  if (config.dryRun) console.log("MODE: DRY RUN\n");

  if (!fs.existsSync(AI_OUTPUT_DIR)) {
    fs.mkdirSync(AI_OUTPUT_DIR, { recursive: true });
  }

  const toProcess = ranked.slice(0, config.limit);
  let completed = 0;
  let failed = 0;
  let totalCost = 0;

  for (const doc of toProcess) {
    if (budgetRemaining <= 0) {
      console.log(`\n  Budget exhausted after ${completed} documents.`);
      break;
    }

    const fileName = doc.eftaNumber || doc.title;

    if (config.dryRun) {
      console.log(`  [DRY RUN] #${doc.id} ${fileName} (score: ${doc.score.toFixed(1)}, DS${doc.dataSet}) → would analyze`);
      completed++;
      continue;
    }

    // Load full text from document_pages
    const fullPages = await db
      .select({ content: documentPages.content })
      .from(documentPages)
      .where(eq(documentPages.documentId, doc.id))
      .orderBy(documentPages.pageNumber);

    const fullText = fullPages.map(p => p.content).join("\n");
    if (fullText.length < 200) {
      console.log(`  Skipping #${doc.id} ${fileName}: text too short (${fullText.length} chars)`);
      failed++;
      continue;
    }

    try {
      const result = await analyzeDocumentTiered(
        fullText,
        fileName,
        doc.dataSet || "unknown",
        1,
        config.model,
      );

      // Save to JSON file
      const outFile = path.join(AI_OUTPUT_DIR, `${fileName}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

      // Save to database
      try {
        const analysisValues = {
          fileName,
          dataSet: doc.dataSet,
          documentType: result.documentType,
          dateOriginal: result.dateOriginal,
          summary: result.summary,
          personCount: result.persons.length,
          connectionCount: result.connections.length,
          eventCount: result.events.length,
          locationCount: result.locations.length,
          keyFactCount: result.keyFacts.length,
          tier: 1 as const,
          costCents: Math.ceil(result.costCents),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          persons: result.persons,
          connectionsData: result.connections,
          events: result.events,
          locations: result.locations,
          keyFacts: result.keyFacts,
          analyzedAt: new Date(),
        };
        const [analysisRow] = await db
          .insert(aiAnalyses)
          .values(analysisValues)
          .onConflictDoUpdate({ target: aiAnalyses.fileName, set: analysisValues })
          .returning({ id: aiAnalyses.id });

        await db
          .delete(aiAnalysisPersons)
          .where(eq(aiAnalysisPersons.aiAnalysisId, analysisRow.id));
        if (result.persons.length > 0) {
          await db.insert(aiAnalysisPersons).values(
            result.persons.map((p: any) => ({
              aiAnalysisId: analysisRow.id,
              name: p.name,
              normalizedName: normalizeName(p.name),
              role: p.role ?? null,
              category: p.category ?? null,
              context: p.context ?? null,
              mentionCount: p.mentionCount ?? 1,
            })),
          );
        }
      } catch (dbErr) {
        console.warn(`  DB write failed for ${fileName}: ${(dbErr as Error).message}`);
      }

      // Update document status
      await db
        .update(documents)
        .set({ aiAnalysisStatus: "completed" })
        .where(eq(documents.id, doc.id));

      // Track cost
      if (result.costCents > 0) {
        await recordCost(doc.id, result.costCents, result.inputTokens, result.outputTokens, config.model);
        budgetRemaining -= result.costCents;
        totalCost += result.costCents;
      }

      completed++;
      console.log(
        `  [${completed}/${toProcess.length}] #${doc.id} ${fileName} (score: ${doc.score.toFixed(1)}): ${result.persons.length} persons, ${result.connections.length} connections, cost $${(result.costCents / 100).toFixed(4)}`,
      );

      // Rate limit between docs
      await sleep(1500);
    } catch (error: any) {
      console.error(`  Error processing #${doc.id} ${fileName}: ${error.message}`);
      failed++;
      if (error.message?.includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await sleep(30000);
      }
    }
  }

  console.log(`\n=== Processing Summary ===`);
  console.log(`Completed: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total cost: $${(totalCost / 100).toFixed(4)}`);
  if (completed > 0 && totalCost > 0) {
    console.log(`Avg cost per doc: $${(totalCost / completed / 100).toFixed(4)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main ---

function printUsage(): void {
  console.log(`
Find High-Value Unanalyzed Documents

Scores unanalyzed documents by signals of importance and outputs a
ranked list of the top candidates for Tier 1 AI analysis.

USAGE:
  npx tsx scripts/pipeline/find-high-value-unanalyzed.ts [options]

OPTIONS:
  --top N             Number of top documents to output (default: 1000)
  --process N         Run Tier 1 analysis on the top N documents
  --monthly-cap N     Monthly budget cap in cents (default: 500 = $5.00)
  --dry-run           Show what --process would do without calling AI
  --model ID          AI model: deepseek-chat (default) or gpt-4o-mini
  --min-score N       Minimum score to include (default: 0)
  --data-sets 9,1,5   Only consider specific data sets
  --output FILE       Write ranked list to a JSON file
  --quiet             Suppress per-document output, show summary only

SCORING:
  Each document is scored 0-100 based on weighted signals:
    Text length    (25%) - Longer docs have more substance
    Person mentions (30%) - Known Epstein-case persons found in text
    Document type   (25%) - Depositions, grand jury > generic records
    Data set origin (20%) - DS9 emails, DS1 FBI files = highest priority

EXAMPLES:
  # See top 100 highest-value unanalyzed documents
  npx tsx scripts/pipeline/find-high-value-unanalyzed.ts --top 100

  # Dry run: see what would be processed
  npx tsx scripts/pipeline/find-high-value-unanalyzed.ts --process 50 --dry-run

  # Process top 200 with $3 budget
  npx tsx scripts/pipeline/find-high-value-unanalyzed.ts --process 200 --monthly-cap 300

  # Export full ranked list to file
  npx tsx scripts/pipeline/find-high-value-unanalyzed.ts --top 5000 --output ranked.json
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  let topN = 1000;
  let processN: number | null = null;
  let monthlyCapCents = 500;
  let dryRun = false;
  let model: string | undefined;
  let minScore = 0;
  let dataSets: string[] | undefined;
  let outputFile: string | undefined;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--top" && args[i + 1]) topN = parseInt(args[++i], 10);
    else if (arg === "--process" && args[i + 1]) processN = parseInt(args[++i], 10);
    else if (arg === "--monthly-cap" && args[i + 1]) monthlyCapCents = parseInt(args[++i], 10);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--model" && args[i + 1]) model = args[++i];
    else if (arg === "--min-score" && args[i + 1]) minScore = parseFloat(args[++i]);
    else if (arg === "--data-sets" && args[i + 1]) dataSets = args[++i].split(",").map(s => s.trim());
    else if (arg === "--output" && args[i + 1]) outputFile = args[++i];
    else if (arg === "--quiet") quiet = true;
  }

  console.log("\n=== Find High-Value Unanalyzed Documents ===\n");

  // Step 1: Find all unanalyzed documents with extracted text
  console.log("Querying unanalyzed documents with extracted text...");
  let candidates = await findUnanalyzedWithText();

  if (dataSets) {
    candidates = candidates.filter(d => d.dataSet && dataSets!.includes(d.dataSet));
  }

  console.log(`Found ${candidates.length} unanalyzed documents with text > 200 chars`);

  if (candidates.length === 0) {
    console.log("No unanalyzed documents found.");
    process.exit(0);
  }

  // Step 2: Score each document
  // We need text samples for person matching and doc type inference.
  // Process in batches to avoid loading too much into memory.
  console.log("Scoring documents (loading text samples for person matching)...\n");

  const scored: ScoredDocument[] = [];
  let batchStart = 0;

  while (batchStart < candidates.length) {
    const batch = candidates.slice(batchStart, batchStart + BATCH_SIZE);

    // Load first ~10000 chars of text per document from document_pages
    for (const doc of batch) {
      const textSample = await getDocumentText(doc.id, 10000);
      if (textSample.length < 200) continue;

      // Score signals
      const { count: personMentionCount, names: personsFound } = countPersonMentions(textSample);
      const inferredDocType = doc.documentType !== "government record"
        ? doc.documentType
        : inferDocumentType(textSample);

      const { score, breakdown } = computeScore(
        doc.extractedTextLength ?? textSample.length,
        personMentionCount,
        inferredDocType,
        doc.dataSet,
      );

      if (score >= minScore) {
        scored.push({
          id: doc.id,
          title: doc.title,
          eftaNumber: doc.eftaNumber,
          dataSet: doc.dataSet,
          documentType: doc.documentType,
          extractedTextLength: doc.extractedTextLength,
          textSample: textSample.slice(0, 200),
          score,
          breakdown,
          personMentionCount,
          inferredDocType,
          personsFound,
        });
      }
    }

    batchStart += BATCH_SIZE;
    if (!quiet && batchStart < candidates.length) {
      process.stdout.write(`  Scored ${Math.min(batchStart, candidates.length)}/${candidates.length} documents...\r`);
    }
  }

  console.log(`\nScored ${scored.length} documents (${candidates.length - scored.length} below min score ${minScore})`);

  // Step 3: Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Step 4: Output results
  const topResults = scored.slice(0, topN);

  if (!quiet) {
    console.log(`\n--- Top ${topResults.length} High-Value Unanalyzed Documents ---\n`);
    console.log(
      "Rank".padEnd(6) +
      "Score".padEnd(8) +
      "ID".padEnd(8) +
      "DS".padEnd(5) +
      "Persons".padEnd(9) +
      "TextLen".padEnd(10) +
      "DocType".padEnd(22) +
      "Title",
    );
    console.log("-".repeat(120));

    for (let i = 0; i < Math.min(topResults.length, 100); i++) {
      const doc = topResults[i];
      const rank = String(i + 1).padEnd(6);
      const score = doc.score.toFixed(1).padEnd(8);
      const id = String(doc.id).padEnd(8);
      const ds = (doc.dataSet || "?").padEnd(5);
      const persons = String(doc.personMentionCount).padEnd(9);
      const textLen = String(doc.extractedTextLength ?? 0).padEnd(10);
      const docType = doc.inferredDocType.slice(0, 20).padEnd(22);
      const title = (doc.eftaNumber || doc.title).slice(0, 50);
      console.log(`${rank}${score}${id}${ds}${persons}${textLen}${docType}${title}`);
    }

    if (topResults.length > 100) {
      console.log(`  ... and ${topResults.length - 100} more (use --output to export full list)`);
    }
  }

  // Summary statistics
  const avgScore = topResults.reduce((sum, d) => sum + d.score, 0) / topResults.length;
  const withPersons = topResults.filter(d => d.personMentionCount > 0).length;
  const byDataSet = new Map<string, number>();
  for (const doc of topResults) {
    const ds = doc.dataSet || "unknown";
    byDataSet.set(ds, (byDataSet.get(ds) ?? 0) + 1);
  }
  const byDocType = new Map<string, number>();
  for (const doc of topResults) {
    byDocType.set(doc.inferredDocType, (byDocType.get(doc.inferredDocType) ?? 0) + 1);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total scored: ${scored.length}`);
  console.log(`Top ${topResults.length} avg score: ${avgScore.toFixed(1)}`);
  console.log(`With known person mentions: ${withPersons} (${((withPersons / topResults.length) * 100).toFixed(0)}%)`);

  console.log(`\nBy data set:`);
  const sortedDS = [...byDataSet.entries()].sort((a, b) => b[1] - a[1]);
  for (const [ds, count] of sortedDS) {
    console.log(`  DS${ds}: ${count}`);
  }

  console.log(`\nBy inferred document type:`);
  const sortedTypes = [...byDocType.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type}: ${count}`);
  }

  // Optional: write to file
  if (outputFile) {
    const outputData = topResults.map(d => ({
      rank: topResults.indexOf(d) + 1,
      id: d.id,
      eftaNumber: d.eftaNumber,
      title: d.title,
      dataSet: d.dataSet,
      score: Math.round(d.score * 10) / 10,
      breakdown: d.breakdown,
      personMentionCount: d.personMentionCount,
      personsFound: d.personsFound,
      inferredDocType: d.inferredDocType,
      extractedTextLength: d.extractedTextLength,
    }));
    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    console.log(`\nRanked list written to: ${outputFile}`);
  }

  // Step 5: Process if --process flag is set
  if (processN !== null) {
    await processTopDocuments(topResults, {
      limit: processN,
      monthlyCapCents,
      dryRun,
      model,
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Error:", err);
    process.exit(1);
  });
