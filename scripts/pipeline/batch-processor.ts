import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { documents, pipelineJobs, budgetTracking } from "../../shared/schema";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import { analyzeDocumentTiered, type AnalysisTier, type TieredAnalysisResult } from "./ai-analyzer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const AI_OUTPUT_DIR = path.join(DATA_DIR, "ai-analyzed");

// Priority queue: DS9 (emails) > DS1 (flights) > DS5 (grand jury) > rest
const DATASET_PRIORITY: Record<string, number> = {
  "9": 100,  // Private emails, correspondence with prominent individuals
  "1": 80,   // FBI investigative files, flight logs, contact books
  "5": 60,   // Grand jury transcripts, SDNY investigation
  "2": 40,   // FBI 302 interview reports
  "3": 35,   // Victim statements, witness interviews
  "4": 30,   // FBI Form 302 interview summaries
  "6": 25,   // Search warrant applications
  "7": 20,   // Financial records
  "8": 15,   // Surveillance footage summaries, MCC records
  "11": 10,  // Financial ledgers, additional flight manifests
  "12": 5,   // Supplemental late productions
  "10": 1,   // Visual/forensic media (mostly images, low text value)
};

const DEFAULT_PRIORITY = 10;
const DEFAULT_MONTHLY_CAP_CENTS = 500; // $5.00 monthly default
const DEFAULT_BATCH_SIZE = 10;
const MIN_TEXT_LENGTH = 200;
const DELAY_BETWEEN_DOCS_MS = 1500;

interface BatchConfig {
  batchSize: number;
  monthlyCapCents: number;
  forceTier?: AnalysisTier;
  dryRun: boolean;
  dataSets?: string[];
  limit?: number;
}

interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  tier0Count: number;
  tier1Count: number;
  totalCostCents: number;
  startTime: number;
}

function getDataSetPriority(dataSet: string | null): number {
  if (!dataSet) return DEFAULT_PRIORITY;
  return DATASET_PRIORITY[dataSet] ?? DEFAULT_PRIORITY;
}

function loadDocumentText(fileName: string, dataSet: string): string | null {
  // Search in extracted directory for matching JSON file
  const dsDir = path.join(EXTRACTED_DIR, `ds${dataSet}`);
  if (!fs.existsSync(dsDir)) return null;

  // Try exact match first
  const exactPath = path.join(dsDir, `${fileName}.json`);
  if (fs.existsSync(exactPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(exactPath, "utf-8"));
      return data.text && data.text.length >= MIN_TEXT_LENGTH ? data.text : null;
    } catch {
      return null;
    }
  }

  // Try fuzzy match (fileName might not include .pdf extension in JSON filename)
  try {
    const entries = fs.readdirSync(dsDir);
    const base = fileName.replace(/\.pdf$/i, "");
    for (const entry of entries) {
      if (entry.startsWith(base) && entry.endsWith(".json")) {
        const data = JSON.parse(fs.readFileSync(path.join(dsDir, entry), "utf-8"));
        return data.text && data.text.length >= MIN_TEXT_LENGTH ? data.text : null;
      }
    }
  } catch {
    // fall through
  }

  return null;
}

// --- Queue Management ---

async function ensureJobsExist(config: BatchConfig): Promise<number> {
  console.log("Scanning documents for pending analysis...");

  // Find documents needing analysis that don't already have a pipeline job
  const pendingDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      dataSet: documents.dataSet,
      eftaNumber: documents.eftaNumber,
      extractedTextLength: documents.extractedTextLength,
      aiAnalysisStatus: documents.aiAnalysisStatus,
    })
    .from(documents)
    .where(
      and(
        eq(documents.aiAnalysisStatus, "pending"),
        ...(config.dataSets ? [inArray(documents.dataSet, config.dataSets)] : []),
      )
    );

  if (pendingDocs.length === 0) {
    console.log("  No documents pending analysis.");
    return 0;
  }

  // Check which already have pipeline jobs
  const existingJobs = await db
    .select({ documentId: pipelineJobs.documentId })
    .from(pipelineJobs)
    .where(
      and(
        eq(pipelineJobs.jobType, "ai_analysis"),
        inArray(pipelineJobs.status, ["pending", "processing"]),
      )
    );

  const existingDocIds = new Set(existingJobs.map(j => j.documentId));
  const newDocs = pendingDocs.filter(d => !existingDocIds.has(d.id));

  if (newDocs.length === 0) {
    console.log(`  All ${pendingDocs.length} pending documents already have pipeline jobs.`);
    return 0;
  }

  // Create pipeline jobs with priority based on data set
  let created = 0;
  for (const doc of newDocs) {
    const priority = getDataSetPriority(doc.dataSet);
    const hasText = (doc.extractedTextLength ?? 0) >= MIN_TEXT_LENGTH;

    await db.insert(pipelineJobs).values({
      documentId: doc.id,
      jobType: "ai_analysis",
      status: "pending",
      priority,
      attempts: 0,
      maxAttempts: 3,
      metadata: {
        dataSet: doc.dataSet,
        eftaNumber: doc.eftaNumber,
        hasExtractedText: hasText,
        textLength: doc.extractedTextLength ?? 0,
      },
    });
    created++;
  }

  console.log(`  Created ${created} new pipeline jobs (${pendingDocs.length - newDocs.length} already queued).`);
  return created;
}

// --- Budget Enforcement ---

async function getMonthlySpend(): Promise<{ totalCents: number; docCount: number }> {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const result = await db
    .select({
      totalCents: sql<number>`COALESCE(SUM(${budgetTracking.costCents}), 0)::int`,
      docCount: sql<number>`COUNT(*)::int`,
    })
    .from(budgetTracking)
    .where(sql`${budgetTracking.date} >= ${monthStart}`);

  return {
    totalCents: result[0]?.totalCents ?? 0,
    docCount: result[0]?.docCount ?? 0,
  };
}

function determineTier(
  hasText: boolean,
  textLength: number,
  budgetRemaining: number,
  forceTier?: AnalysisTier,
): AnalysisTier {
  if (forceTier !== undefined) return forceTier;

  // No text or very short text: Tier 0 only
  if (!hasText || textLength < MIN_TEXT_LENGTH) return 0;

  // Budget exhausted: fall back to Tier 0
  if (budgetRemaining <= 0) return 0;

  // Has text and budget: use Tier 1
  return 1;
}

// --- Batch Processing ---

async function getNextBatch(batchSize: number): Promise<Array<{
  jobId: number;
  documentId: number;
  priority: number;
  attempts: number;
  maxAttempts: number;
  metadata: any;
}>> {
  const jobs = await db
    .select({
      jobId: pipelineJobs.id,
      documentId: pipelineJobs.documentId,
      priority: pipelineJobs.priority,
      attempts: pipelineJobs.attempts,
      maxAttempts: pipelineJobs.maxAttempts,
      metadata: pipelineJobs.metadata,
    })
    .from(pipelineJobs)
    .where(
      and(
        eq(pipelineJobs.jobType, "ai_analysis"),
        eq(pipelineJobs.status, "pending"),
      )
    )
    .orderBy(desc(pipelineJobs.priority))
    .limit(batchSize);

  return jobs.filter(j => j.documentId !== null) as Array<{
    jobId: number;
    documentId: number;
    priority: number;
    attempts: number;
    maxAttempts: number;
    metadata: any;
  }>;
}

async function markJobProcessing(jobId: number): Promise<void> {
  await db
    .update(pipelineJobs)
    .set({ status: "processing", startedAt: new Date() })
    .where(eq(pipelineJobs.id, jobId));
}

async function markJobCompleted(jobId: number): Promise<void> {
  await db
    .update(pipelineJobs)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(pipelineJobs.id, jobId));
}

async function markJobFailed(jobId: number, error: string, attempts: number, maxAttempts: number): Promise<void> {
  const newStatus = attempts + 1 >= maxAttempts ? "failed" : "pending";
  await db
    .update(pipelineJobs)
    .set({
      status: newStatus,
      attempts: attempts + 1,
      errorMessage: error,
    })
    .where(eq(pipelineJobs.id, jobId));
}

async function recordCost(
  documentId: number,
  costCents: number,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await db.insert(budgetTracking).values({
    date: today,
    model: "deepseek/deepseek-chat-v3-0324",
    inputTokens,
    outputTokens,
    costCents: Math.round(costCents * 100) / 100,
    documentId,
    jobType: "ai_analysis",
  });

  // Update per-document cost
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

function formatETA(progress: BatchProgress): string {
  if (progress.completed === 0) return "calculating...";

  const elapsed = Date.now() - progress.startTime;
  const avgPerDoc = elapsed / progress.completed;
  const remaining = progress.total - progress.completed - progress.failed - progress.skipped;
  const etaMs = remaining * avgPerDoc;

  if (etaMs < 60_000) return `${Math.ceil(etaMs / 1000)}s`;
  if (etaMs < 3_600_000) return `${Math.ceil(etaMs / 60_000)}m`;
  return `${(etaMs / 3_600_000).toFixed(1)}h`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// --- Main Batch Loop ---

async function processBatch(config: BatchConfig): Promise<BatchProgress> {
  const progress: BatchProgress = {
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    tier0Count: 0,
    tier1Count: 0,
    totalCostCents: 0,
    startTime: Date.now(),
  };

  // Ensure output directory exists
  if (!fs.existsSync(AI_OUTPUT_DIR)) {
    fs.mkdirSync(AI_OUTPUT_DIR, { recursive: true });
  }

  // Ensure jobs exist in queue
  await ensureJobsExist(config);

  // Count total pending
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(pipelineJobs)
    .where(
      and(
        eq(pipelineJobs.jobType, "ai_analysis"),
        eq(pipelineJobs.status, "pending"),
      )
    );
  progress.total = countResult[0]?.count ?? 0;

  if (progress.total === 0) {
    console.log("\nNo pending jobs to process.");
    return progress;
  }

  console.log(`\nTotal pending jobs: ${progress.total}`);

  // Check budget
  const { totalCents: monthlySpent, docCount: monthlyDocs } = await getMonthlySpend();
  const budgetRemaining = config.monthlyCapCents - monthlySpent;

  console.log(`Monthly budget: ${formatCents(config.monthlyCapCents)} (spent: ${formatCents(monthlySpent)} on ${monthlyDocs} docs, remaining: ${formatCents(budgetRemaining)})`);

  if (budgetRemaining <= 0 && config.forceTier !== 0) {
    console.log("Monthly budget exhausted. Tier 1 analysis disabled, falling back to Tier 0.");
  }

  let processedInSession = 0;
  const limit = config.limit ?? Infinity;
  let currentBudgetRemaining = budgetRemaining;

  while (processedInSession < limit) {
    const batch = await getNextBatch(Math.min(config.batchSize, limit - processedInSession));
    if (batch.length === 0) break;

    for (const job of batch) {
      if (processedInSession >= limit) break;

      const meta = (job.metadata as any) ?? {};
      const dataSet = meta.dataSet ?? "unknown";
      const eftaNumber = meta.eftaNumber ?? "";
      const hasText = meta.hasExtractedText ?? false;
      const textLength = meta.textLength ?? 0;

      // Load document details
      const docRows = await db
        .select({ title: documents.title, localPath: documents.localPath })
        .from(documents)
        .where(eq(documents.id, job.documentId))
        .limit(1);

      if (docRows.length === 0) {
        await markJobFailed(job.jobId, "Document not found in database", job.attempts, job.maxAttempts);
        progress.failed++;
        processedInSession++;
        continue;
      }

      const doc = docRows[0];
      const fileName = eftaNumber || doc.title;

      // Load extracted text
      const text = loadDocumentText(fileName, dataSet);

      if (!text) {
        // No extracted text: Tier 0 with empty text marker
        if (config.dryRun) {
          console.log(`  [DRY RUN] ${fileName} (DS${dataSet}) → Tier 0 (no text)`);
          progress.skipped++;
          processedInSession++;
          continue;
        }

        await markJobProcessing(job.jobId);
        const result = await analyzeDocumentTiered("", fileName, dataSet, 0);

        const outFile = path.join(AI_OUTPUT_DIR, `${fileName}.json`);
        fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

        await db
          .update(documents)
          .set({ aiAnalysisStatus: "completed", aiCostCents: 0 })
          .where(eq(documents.id, job.documentId));

        await markJobCompleted(job.jobId);
        progress.completed++;
        progress.tier0Count++;
        processedInSession++;
        continue;
      }

      // Determine tier
      const tier = determineTier(true, text.length, currentBudgetRemaining, config.forceTier);

      if (config.dryRun) {
        console.log(`  [DRY RUN] ${fileName} (DS${dataSet}, ${text.length} chars, priority ${job.priority}) → Tier ${tier}`);
        progress.skipped++;
        processedInSession++;
        continue;
      }

      // Process document
      await markJobProcessing(job.jobId);

      try {
        const result = await analyzeDocumentTiered(text, fileName, dataSet, tier);

        // Save to file
        const outFile = path.join(AI_OUTPUT_DIR, `${fileName}.json`);
        fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

        // Update document status
        await db
          .update(documents)
          .set({
            aiAnalysisStatus: "completed",
            aiCostCents: Math.ceil(result.costCents),
          })
          .where(eq(documents.id, job.documentId));

        // Track cost for Tier 1
        if (tier === 1 && result.costCents > 0) {
          await recordCost(job.documentId, result.costCents, result.inputTokens, result.outputTokens);
          currentBudgetRemaining -= result.costCents;
          progress.totalCostCents += result.costCents;
        }

        await markJobCompleted(job.jobId);

        if (tier === 0) progress.tier0Count++;
        else progress.tier1Count++;
        progress.completed++;
        processedInSession++;

        // Progress report
        const eta = formatETA(progress);
        const personCount = result.persons.length;
        console.log(
          `  [${progress.completed}/${progress.total}] ${fileName} (DS${dataSet}) → Tier ${tier}: ${personCount} persons, cost ${formatCents(result.costCents)} | ETA: ${eta}`
        );

        // Rate limiting between docs
        if (tier === 1) {
          await sleep(DELAY_BETWEEN_DOCS_MS);
        }
      } catch (error: any) {
        console.error(`  Error processing ${fileName}: ${error.message}`);
        await markJobFailed(job.jobId, error.message, job.attempts, job.maxAttempts);
        progress.failed++;
        processedInSession++;

        // Back off on rate limits
        if (error.message?.includes("429")) {
          console.log("  Rate limited, waiting 30s...");
          await sleep(30000);
        }
      }
    }
  }

  return progress;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- CLI ---

function printUsage() {
  console.log(`
Batch Processor - AI Document Analysis Pipeline

Processes documents through tiered AI analysis with budget enforcement
and priority-based queue management.

USAGE:
  npx tsx scripts/pipeline/batch-processor.ts [options]

OPTIONS:
  --batch-size N      Documents per batch (default: ${DEFAULT_BATCH_SIZE})
  --monthly-cap N     Monthly budget cap in cents (default: ${DEFAULT_MONTHLY_CAP_CENTS} = ${formatCents(DEFAULT_MONTHLY_CAP_CENTS)})
  --tier 0|1          Force a specific tier (default: auto)
  --dry-run           Show what would be processed without doing it
  --data-sets 9,1,5   Only process specific data sets
  --limit N           Max documents to process in this run
  --status            Show queue status and budget, then exit

TIERS:
  0  FREE     Rule-based classification (person matching, doc type inference)
  1  DeepSeek Full AI analysis (~$0.001/doc via deepseek-chat-v3)

PRIORITY QUEUE (highest first):
  DS9  (100)  Private emails, DOJ NPA documents
  DS1  (80)   FBI files, flight logs, contact books
  DS5  (60)   Grand jury transcripts, SDNY investigation
  DS2  (40)   FBI 302 interview reports
  DS3  (35)   Victim statements, witness interviews
  DS4  (30)   FBI Form 302 summaries
  DS6  (25)   Search warrants, property inventories
  DS7  (20)   Financial records
  DS8  (15)   Surveillance footage, MCC records
  DS11 (10)   Financial ledgers, additional manifests
  DS12 (5)    Supplemental late productions
  DS10 (1)    Visual/forensic media

EXAMPLES:
  # Dry run to see what would be processed
  npx tsx scripts/pipeline/batch-processor.ts --dry-run

  # Process high-priority data sets with $2 budget
  npx tsx scripts/pipeline/batch-processor.ts --data-sets 9,1,5 --monthly-cap 200

  # Free tier only (no API costs)
  npx tsx scripts/pipeline/batch-processor.ts --tier 0

  # Process 50 documents max
  npx tsx scripts/pipeline/batch-processor.ts --limit 50

  # Check current status
  npx tsx scripts/pipeline/batch-processor.ts --status
`);
}

async function showStatus(): Promise<void> {
  console.log("\n=== Batch Processor Status ===\n");

  // Job queue stats
  const jobStats = await db
    .select({
      status: pipelineJobs.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(pipelineJobs)
    .where(eq(pipelineJobs.jobType, "ai_analysis"))
    .groupBy(pipelineJobs.status);

  console.log("Pipeline Jobs:");
  for (const stat of jobStats) {
    console.log(`  ${stat.status}: ${stat.count}`);
  }
  if (jobStats.length === 0) console.log("  (none)");

  // Document analysis stats
  const docStats = await db
    .select({
      status: documents.aiAnalysisStatus,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(documents)
    .groupBy(documents.aiAnalysisStatus);

  console.log("\nDocument Analysis Status:");
  for (const stat of docStats) {
    console.log(`  ${stat.status ?? "null"}: ${stat.count}`);
  }

  // Budget
  const { totalCents, docCount } = await getMonthlySpend();
  console.log(`\nMonthly Spend: ${formatCents(totalCents)} across ${docCount} documents`);

  // Top priority pending
  const topJobs = await db
    .select({
      priority: pipelineJobs.priority,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(pipelineJobs)
    .where(
      and(
        eq(pipelineJobs.jobType, "ai_analysis"),
        eq(pipelineJobs.status, "pending"),
      )
    )
    .groupBy(pipelineJobs.priority)
    .orderBy(desc(pipelineJobs.priority))
    .limit(5);

  if (topJobs.length > 0) {
    console.log("\nPending by Priority:");
    for (const j of topJobs) {
      const dsName = Object.entries(DATASET_PRIORITY).find(([_, v]) => v === j.priority)?.[0];
      console.log(`  Priority ${j.priority}${dsName ? ` (DS${dsName})` : ""}: ${j.count} jobs`);
    }
  }

  console.log("");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  if (args.includes("--status")) {
    await showStatus();
    process.exit(0);
  }

  const config: BatchConfig = {
    batchSize: DEFAULT_BATCH_SIZE,
    monthlyCapCents: DEFAULT_MONTHLY_CAP_CENTS,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch-size" && args[i + 1]) {
      config.batchSize = parseInt(args[++i], 10);
    } else if (arg === "--monthly-cap" && args[i + 1]) {
      config.monthlyCapCents = parseInt(args[++i], 10);
    } else if (arg === "--tier" && args[i + 1]) {
      const t = parseInt(args[++i], 10);
      if (t === 0 || t === 1) config.forceTier = t as AnalysisTier;
    } else if (arg === "--dry-run") {
      config.dryRun = true;
    } else if (arg === "--data-sets" && args[i + 1]) {
      config.dataSets = args[++i].split(",").map(s => s.trim());
    } else if (arg === "--limit" && args[i + 1]) {
      config.limit = parseInt(args[++i], 10);
    }
  }

  console.log("\n=== Batch Processor: Tiered AI Analysis ===\n");
  console.log(`Batch size: ${config.batchSize}`);
  console.log(`Monthly cap: ${formatCents(config.monthlyCapCents)}`);
  console.log(`Tier: ${config.forceTier !== undefined ? config.forceTier : "auto"}`);
  console.log(`Data sets: ${config.dataSets?.join(", ") || "all"}`);
  console.log(`Limit: ${config.limit ?? "none"}`);
  if (config.dryRun) console.log("MODE: DRY RUN");

  const progress = await processBatch(config);

  // Summary
  const elapsed = ((Date.now() - progress.startTime) / 1000).toFixed(1);

  console.log("\n=== Batch Processing Summary ===");
  console.log(`Total time: ${elapsed}s`);
  console.log(`Completed: ${progress.completed} (Tier 0: ${progress.tier0Count}, Tier 1: ${progress.tier1Count})`);
  console.log(`Failed: ${progress.failed}`);
  if (progress.skipped > 0) console.log(`Skipped: ${progress.skipped}`);
  console.log(`Total cost: ${formatCents(progress.totalCostCents)}`);

  if (progress.tier1Count > 0) {
    const avgCost = progress.totalCostCents / progress.tier1Count;
    console.log(`Avg cost per Tier 1 doc: ${formatCents(avgCost)}`);
  }

  const { totalCents } = await getMonthlySpend();
  console.log(`Monthly spend to date: ${formatCents(totalCents)} / ${formatCents(config.monthlyCapCents)}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Batch processor error:", err);
    process.exit(1);
  });
