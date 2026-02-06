import { scrapeDOJCatalog } from "./doj-scraper";
import { scrapeWikipediaPersons } from "./wikipedia-scraper";
import { downloadDocuments } from "./document-downloader";
import { processDocuments } from "./pdf-processor";
import { extractEntities } from "./entity-extractor";
import { loadPersonsFromFile, loadDocumentsFromCatalog, loadExtractedEntities, extractConnectionsFromDescriptions, updateDocumentCounts } from "./db-loader";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

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
}

const STAGES = [
  "scrape-doj",
  "scrape-wikipedia",
  "download",
  "process",
  "extract",
  "load-persons",
  "load-documents",
  "load-entities",
  "extract-connections",
  "update-counts",
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
  scrape-wikipedia Scrape Wikipedia for comprehensive person list
  download         Download documents from DOJ (PDFs, images, etc.)
  process          Extract text from downloaded PDFs via OCR/parsing
  extract          Run NLP entity extraction on processed documents
  load-persons     Load scraped persons into PostgreSQL database
  load-documents   Load document catalog into PostgreSQL database
  load-entities    Load extracted entities into PostgreSQL database
  extract-connections  Extract relationships from person descriptions
  update-counts    Recalculate document/connection counts per person
  quick            Run scrape-wikipedia + load-persons + extract-connections + update-counts
                   (fastest way to populate app with comprehensive data)

OPTIONS:
  --data-sets 1,2,3    Only process specific data set IDs
  --max-downloads 100  Limit number of downloads
  --max-process 50     Limit number of files to process
  --rate-limit 2000    Milliseconds between downloads (default: 2000)
  --types pdf,jpg      File types to download/process

EXAMPLES:
  # Quick start: populate database with Wikipedia data
  npx tsx scripts/pipeline/run-pipeline.ts quick

  # Full pipeline
  npx tsx scripts/pipeline/run-pipeline.ts all

  # Scrape DOJ + download first 10 PDFs from data set 9
  npx tsx scripts/pipeline/run-pipeline.ts scrape-doj download --data-sets 9 --max-downloads 10

  # Just scrape and load persons
  npx tsx scripts/pipeline/run-pipeline.ts scrape-wikipedia load-persons update-counts

  # Process already-downloaded documents
  npx tsx scripts/pipeline/run-pipeline.ts process extract load-entities

DATA FLOW:
  1. scrape-doj       → data/doj-catalog.json
  2. scrape-wikipedia  → data/persons-raw.json
  3. download          → data/downloads/data-set-{N}/
  4. process           → data/extracted/ds{N}/*.json
  5. extract           → data/entities.json
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
        await scrapeDOJCatalog();
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
        });
        break;

      case "process":
        await processDocuments({
          dataSetIds: config.dataSetIds,
          maxFiles: config.maxProcessFiles,
          fileTypes: config.fileTypes?.map(t => t.startsWith(".") ? t : `.${t}`),
        });
        break;

      case "extract":
        await extractEntities({});
        break;

      case "load-persons":
        await loadPersonsFromFile();
        break;

      case "load-documents":
        await loadDocumentsFromCatalog();
        break;

      case "load-entities":
        await loadExtractedEntities();
        break;

      case "extract-connections":
        await extractConnectionsFromDescriptions();
        break;

      case "update-counts":
        await updateDocumentCounts();
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
    } else if (arg === "all") {
      config.stages = [...STAGES];
    } else if (arg === "quick") {
      config.stages = ["scrape-wikipedia", "load-persons", "extract-connections", "update-counts"];
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
  console.log(`\nStarting pipeline with stages: ${config.stages.join(" → ")}\n`);

  const results: Record<string, string> = {};

  for (const stage of config.stages) {
    try {
      await runStage(stage, config);
      results[stage] = "SUCCESS";
    } catch (error: any) {
      results[stage] = `FAILED: ${error.message}`;
      console.error(`\nPipeline stopped at stage '${stage}'. Remaining stages skipped.`);
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
