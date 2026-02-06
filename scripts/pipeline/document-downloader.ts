import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { DOJFile, DOJCatalog } from "./doj-scraper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const PROGRESS_FILE = path.join(DATA_DIR, "download-progress.json");
const CATALOG_FILE = path.join(DATA_DIR, "doj-catalog.json");

interface DownloadProgress {
  completed: string[];
  failed: string[];
  inProgress: string | null;
  totalBytes: number;
  startedAt: string;
  lastUpdated: string;
}

function loadProgress(): DownloadProgress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return {
    completed: [],
    failed: [],
    inProgress: null,
    totalBytes: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: DownloadProgress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function downloadFile(
  file: DOJFile,
  outputDir: string,
  progress: DownloadProgress,
  retries: number = 3
): Promise<boolean> {
  const safeFilename = file.url
    .split("/")
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, "_") || `file_${Date.now()}.pdf`;

  const dataSetDir = path.join(outputDir, `data-set-${file.dataSetId}`);
  if (!fs.existsSync(dataSetDir)) fs.mkdirSync(dataSetDir, { recursive: true });

  const outputPath = path.join(dataSetDir, safeFilename);

  if (fs.existsSync(outputPath)) {
    console.log(`  Skipping (already exists): ${safeFilename}`);
    return true;
  }

  if (progress.completed.includes(file.url)) {
    console.log(`  Skipping (already downloaded): ${safeFilename}`);
    return true;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      progress.inProgress = file.url;
      saveProgress(progress);

      console.log(`  Downloading (attempt ${attempt}/${retries}): ${safeFilename}`);

      const response = await fetch(file.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; EpsteinFilesExplorer/1.0; research)",
          "Accept": "*/*",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        console.warn(`  HTTP ${response.status} for ${file.url}`);
        if (attempt === retries) {
          progress.failed.push(file.url);
          saveProgress(progress);
          return false;
        }
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(buffer));

      const fileSize = buffer.byteLength;
      progress.completed.push(file.url);
      progress.totalBytes += fileSize;
      progress.inProgress = null;
      saveProgress(progress);

      console.log(`  Downloaded: ${safeFilename} (${(fileSize / 1024).toFixed(1)} KB)`);
      return true;
    } catch (error: any) {
      console.warn(`  Error downloading ${safeFilename}: ${error.message}`);
      if (attempt === retries) {
        progress.failed.push(file.url);
        saveProgress(progress);
        return false;
      }
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  return false;
}

export async function downloadDocuments(options: {
  dataSetIds?: number[];
  fileTypes?: string[];
  maxFiles?: number;
  concurrency?: number;
  rateLimitMs?: number;
}): Promise<void> {
  console.log("\n=== DOJ Document Downloader ===\n");

  const {
    dataSetIds,
    fileTypes = ["pdf"],
    maxFiles = Infinity,
    rateLimitMs = 2000,
  } = options;

  if (!fs.existsSync(CATALOG_FILE)) {
    console.error("Error: No catalog found. Run the DOJ scraper first.");
    console.error("  npx tsx scripts/pipeline/doj-scraper.ts");
    return;
  }

  const catalog: DOJCatalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf-8"));
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  let files = catalog.dataSets.flatMap(ds => ds.files);

  if (dataSetIds && dataSetIds.length > 0) {
    files = files.filter(f => dataSetIds.includes(f.dataSetId));
  }

  if (fileTypes && fileTypes.length > 0) {
    files = files.filter(f => fileTypes.includes(f.fileType.toLowerCase()));
  }

  files = files.slice(0, maxFiles);

  console.log(`Files to download: ${files.length}`);
  console.log(`File types: ${fileTypes.join(", ")}`);
  console.log(`Rate limit: ${rateLimitMs}ms between downloads`);
  console.log(`Output directory: ${DOWNLOADS_DIR}\n`);

  const progress = loadProgress();
  let downloadedCount = 0;
  let failedCount = 0;

  for (const file of files) {
    const success = await downloadFile(file, DOWNLOADS_DIR, progress);
    if (success) {
      downloadedCount++;
    } else {
      failedCount++;
    }

    await new Promise(r => setTimeout(r, rateLimitMs));

    if ((downloadedCount + failedCount) % 10 === 0) {
      console.log(`\nProgress: ${downloadedCount} downloaded, ${failedCount} failed, ${files.length - downloadedCount - failedCount} remaining`);
      console.log(`Total size: ${(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB\n`);
    }
  }

  console.log("\n=== Download Summary ===");
  console.log(`Total downloaded: ${downloadedCount}`);
  console.log(`Total failed: ${failedCount}`);
  console.log(`Total size: ${(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`Progress saved to: ${PROGRESS_FILE}`);
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof downloadDocuments>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data-sets" && args[i + 1]) {
      options.dataSetIds = args[++i].split(",").map(Number);
    } else if (args[i] === "--types" && args[i + 1]) {
      options.fileTypes = args[++i].split(",");
    } else if (args[i] === "--max" && args[i + 1]) {
      options.maxFiles = parseInt(args[++i], 10);
    } else if (args[i] === "--rate-limit" && args[i + 1]) {
      options.rateLimitMs = parseInt(args[++i], 10);
    }
  }

  downloadDocuments(options).catch(console.error);
}
