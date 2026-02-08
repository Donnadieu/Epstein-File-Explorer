import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { runAIAnalysis } from "./ai-analyzer";
import {
  deduplicatePersonsInDB,
  extractConnectionsFromDescriptions,
  importDownloadedFiles,
  loadAIResults,
  loadDocumentsFromCatalog,
  loadPersonsFromFile,
  updateDocumentCounts,
} from "./db-loader";
import { downloadDocuments } from "./document-downloader";
import { probeAndMergeCatalog, scrapeDOJCatalog } from "./doj-scraper";
import { classifyAllDocuments } from "./media-classifier";
import { processDocuments } from "./pdf-processor";
import { migrateToR2 } from "./r2-migration";
import { scrapeWikipediaPersons } from "./wikipedia-scraper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

interface PipelineConfig {
  stages: string[];
  dataSetIds?: number[];
  maxDownloads?: number;
  maxProcessFiles?: number;
  rateLimitMs?: number;
  fileTypes?: string[];
  budget?: number;
  priority?: number;
  batchSize?: number;
  concurrency?: number;
  retryFailed?: boolean;
}

const STAGES = [
  "scrape-doj",
  "probe-doj",
  "scrape-wikipedia",
  "download",
  "upload-r2",
  "process",
  "classify-media",
  "analyze-ai",
  "load-ai-results",
  "load-persons",
  "load-documents",
  "import-downloads",
  "extract-connections",
  "update-counts",
  "dedup-persons",
];

function printUsage() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          EPSTEIN FILES EXTRACTION PIPELINE                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  A comprehensive pipeline for scraping, downloading,         ║
║  processing, and loading data from the DOJ's Epstein         ║
║  files releases into the Explorer database.                  ║
║                                                              ║
║  Source: justice.gov/epstein (3.5M+ pages, 180K images,      ║
║          2K videos across 12 data sets)                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

USAGE:
  npx tsx scripts/pipeline/run-pipeline.ts [stages] [options]

STAGES:
  all              Run all stages in order
  scrape-doj       Scrape DOJ Epstein Library for document catalog
  probe-doj        Probe sequential EFTA numbers via HEAD requests to discover unlisted files
  scrape-wikipedia Scrape Wikipedia for comprehensive person list
  download         Download documents from DOJ (PDFs, images, etc.)
  upload-r2        Upload downloaded files to Cloudflare R2 storage
  process          Extract text from downloaded PDFs via OCR/parsing
  classify-media   Classify documents by media type and set AI priority
  analyze-ai       Run AI analysis on processed documents (DeepSeek)
  load-ai-results  Load AI-analyzed persons, connections, and events into database
  load-persons     Load scraped persons into PostgreSQL database
  load-documents   Load document catalog into PostgreSQL database
  import-downloads Import downloaded PDFs from filesystem into database
  extract-connections  Extract relationships from person descriptions
  update-counts    Recalculate document/connection counts per person

SHORTCUTS:
  quick            Run scrape-wikipedia + load-persons + extract-connections + update-counts
                   (fastest way to populate app with comprehensive data)
  full-discovery   Run all scraping, downloading, processing, and loading stages
                   (scrape-doj → scrape-wikipedia → download → process →
                    classify-media → analyze-ai → load-ai-results → load-persons →
                    load-documents → import-downloads → extract-connections → update-counts)
  analyze-priority Run AI analysis on highest-priority unanalyzed documents
                   (classify-media → analyze-ai → load-ai-results → update-counts)

OPTIONS:
  --data-sets 1,2,3    Only process specific data set IDs
  --max-downloads 100  Limit number of downloads
  --max-process 50     Limit number of files to process
  --rate-limit 2000    Milliseconds between downloads (default: 2000)
  --types pdf,jpg      File types to download/process
  --budget 500         AI analysis budget cap in cents (default: unlimited)
  --priority 3         Minimum priority level for analyze-priority (1-5, default: 1)
  --batch-size 20      Number of documents per batch (default: 50)
  --concurrency 4      Max parallel operations (default: 1)

EXAMPLES:
  # Quick start: populate database with Wikipedia data
  npx tsx scripts/pipeline/run-pipeline.ts quick

  # Full pipeline
  npx tsx scripts/pipeline/run-pipeline.ts all

  # Full discovery pipeline (scrape + download + process + load)
  npx tsx scripts/pipeline/run-pipeline.ts full-discovery --max-downloads 100

  # AI analysis of priority documents with budget cap
  npx tsx scripts/pipeline/run-pipeline.ts analyze-priority --budget 500 --priority 3

  # Scrape DOJ + download first 10 PDFs from data set 9
  npx tsx scripts/pipeline/run-pipeline.ts scrape-doj download --data-sets 9 --max-downloads 10

  # Just scrape and load persons
  npx tsx scripts/pipeline/run-pipeline.ts scrape-wikipedia load-persons update-counts

  # Process already-downloaded documents and load AI results
  npx tsx scripts/pipeline/run-pipeline.ts process analyze-ai load-ai-results

  # Classify media types for downloaded files
  npx tsx scripts/pipeline/run-pipeline.ts classify-media --data-sets 10

  # Run AI analysis with concurrency and batch size
  npx tsx scripts/pipeline/run-pipeline.ts analyze-ai --batch-size 10 --concurrency 2 --budget 1000

DATA FLOW:
  1. scrape-doj       → data/doj-catalog.json
  2. scrape-wikipedia  → data/persons-raw.json
  3. download          → data/downloads/data-set-{N}/
  3b. upload-r2        → Cloudflare R2 (data-set-{N}/{filename})
  4. process           → data/extracted/ds{N}/*.json
  5. analyze-ai        → data/ai-analyzed/*.json
  6. load-*            → PostgreSQL database
`);
}

async function runStage(stage: string, config: PipelineConfig): Promise<void> {
  const startTime = Date.now();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`STAGE: ${stage.toUpperCase()}`);
  console.log(`${"=".repeat(60)}`);

  try {
    switch (stage) {
      case "scrape-doj":
        await scrapeDOJCatalog(config.dataSetIds);
        break;

      case "probe-doj":
        await probeAndMergeCatalog(config.dataSetIds);
        break;

      case "scrape-wikipedia":
        await scrapeWikipediaPersons();
        break;

      case "download":
        await downloadDocuments({
          dataSetIds: config.dataSetIds,
          maxFiles: config.maxDownloads,
          rateLimitMs: config.rateLimitMs,
          fileTypes: config.fileTypes,
          retryFailed: config.retryFailed,
        });
        break;

      case "upload-r2":
        await migrateToR2({
          dataSetIds: config.dataSetIds,
          concurrency: config.concurrency,
        });
        break;

      case "process":
        await processDocuments({
          dataSetIds: config.dataSetIds,
          maxFiles: config.maxProcessFiles,
          fileTypes: config.fileTypes?.map((t) =>
            t.startsWith(".") ? t : `.${t}`,
          ),
        });
        break;

      case "classify-media":
        await classifyAllDocuments();
        break;

      case "analyze-ai":
        await runAIAnalysis({
          limit: config.batchSize,
          delayMs: config.concurrency && config.concurrency > 1 ? 500 : 1500,
        });
        break;

      case "load-ai-results":
        await loadAIResults();
        break;

      case "load-persons":
        await loadPersonsFromFile();
        break;

      case "load-documents":
        await loadDocumentsFromCatalog();
        break;

      case "import-downloads":
        await importDownloadedFiles();
        break;

      case "extract-connections":
        await extractConnectionsFromDescriptions();
        break;

      case "update-counts":
        await updateDocumentCounts();
        break;

      case "dedup-persons":
        await deduplicatePersonsInDB();
        break;

      default:
        console.error(`Unknown stage: ${stage}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nStage '${stage}' completed in ${elapsed}s`);
  } catch (error: any) {
    console.error(`\nStage '${stage}' FAILED: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const config: PipelineConfig = { stages: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--data-sets" && args[i + 1]) {
      config.dataSetIds = args[++i].split(",").map(Number);
    } else if (arg === "--max-downloads" && args[i + 1]) {
      config.maxDownloads = parseInt(args[++i], 10);
    } else if (arg === "--max-process" && args[i + 1]) {
      config.maxProcessFiles = parseInt(args[++i], 10);
    } else if (arg === "--rate-limit" && args[i + 1]) {
      config.rateLimitMs = parseInt(args[++i], 10);
    } else if (arg === "--types" && args[i + 1]) {
      config.fileTypes = args[++i].split(",");
    } else if (arg === "--budget" && args[i + 1]) {
      config.budget = parseInt(args[++i], 10);
    } else if (arg === "--priority" && args[i + 1]) {
      config.priority = parseInt(args[++i], 10);
    } else if (arg === "--batch-size" && args[i + 1]) {
      config.batchSize = parseInt(args[++i], 10);
    } else if (arg === "--concurrency" && args[i + 1]) {
      config.concurrency = parseInt(args[++i], 10);
    } else if (arg === "--retry-failed") {
      config.retryFailed = true;
    } else if (arg === "all") {
      config.stages = [...STAGES];
    } else if (arg === "quick") {
      config.stages = [
        "scrape-wikipedia",
        "load-persons",
        "extract-connections",
        "update-counts",
      ];
    } else if (arg === "full-discovery") {
      config.stages = [
        "scrape-doj",
        "scrape-wikipedia",
        "download",
        "upload-r2",
        "process",
        "classify-media",
        "analyze-ai",
        "load-ai-results",
        "load-persons",
        "load-documents",
        "import-downloads",
        "extract-connections",
        "update-counts",
      ];
    } else if (arg === "analyze-priority") {
      config.stages = [
        "classify-media",
        "analyze-ai",
        "load-ai-results",
        "update-counts",
      ];
    } else if (STAGES.includes(arg)) {
      config.stages.push(arg);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      return;
    }
  }

  if (config.stages.length === 0) {
    console.error("No stages specified.");
    printUsage();
    return;
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const pipelineStart = Date.now();
  console.log(
    `\nStarting pipeline with stages: ${config.stages.join(" → ")}\n`,
  );

  const results: Record<string, string> = {};

  for (const stage of config.stages) {
    try {
      await runStage(stage, config);
      results[stage] = "SUCCESS";
    } catch (error: any) {
      results[stage] = `FAILED: ${error.message}`;
      console.error(
        `\nPipeline stopped at stage '${stage}'. Remaining stages skipped.`,
      );
      break;
    }
  }

  const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);

  console.log(`\n${"=".repeat(60)}`);
  console.log("PIPELINE COMPLETE");
  console.log(`${"=".repeat(60)}`);
  console.log(`Total time: ${totalElapsed}s\n`);
  console.log("Stage Results:");
  for (const [stage, result] of Object.entries(results)) {
    const icon = result === "SUCCESS" ? "[OK]" : "[FAIL]";
    console.log(`  ${icon} ${stage}: ${result}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error("Pipeline error:", error);
  process.exit(1);
});
