import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import pLimit from "p-limit";
import { db } from "../../server/db";
import { documents } from "../../shared/schema";
import { sql, eq } from "drizzle-orm";
import { isR2Configured, uploadToR2, buildR2Key } from "../../server/r2";
import type { DOJFile, DOJCatalog } from "./doj-scraper";
import { getBrowserContext, extractCookieHeader, closeBrowser } from "./doj-scraper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const PROGRESS_FILE = path.join(DATA_DIR, "download-progress.json");
const CATALOG_FILE = path.join(DATA_DIR, "doj-catalog.json");

const STREAM_THRESHOLD = 10 * 1024 * 1024; // 10MB — use streaming writes above this
const MAX_CONCURRENCY = 2;
const BASE_INTERVAL_MS = 1500; // 1.5s base delay between requests
const JITTER_MS = 1000;       // up to 1s random jitter (1.5–2.5s total)

interface DownloadProgress {
  completed: Record<string, { hash: string; localPath: string; bytes: number }>;
  failed: string[];
  totalBytes: number;
  startedAt: string;
  lastUpdated: string;
}

interface DownloadResult {
  url: string;
  success: boolean;
  localPath?: string;
  fileSizeBytes?: number;
  fileHash?: string;
  r2Key?: string;
  error?: string;
}

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  mp4: "video/mp4",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

function loadProgress(): DownloadProgress {
  if (fs.existsSync(PROGRESS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
    // Migrate old array-based format
    if (Array.isArray(raw.completed)) {
      const migrated: DownloadProgress = {
        completed: {},
        failed: raw.failed || [],
        totalBytes: raw.totalBytes || 0,
        startedAt: raw.startedAt || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
      for (const url of raw.completed) {
        migrated.completed[url] = { hash: "", localPath: "", bytes: 0 };
      }
      return migrated;
    }
    return raw;
  }
  return {
    completed: {},
    failed: [],
    totalBytes: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: DownloadProgress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function safeFilename(url: string): string {
  return (
    url.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") ||
    `file_${Date.now()}`
  );
}

async function computeHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** Rate-limiter: fixed delay + random jitter to avoid triggering Akamai WAF */
let lastRequestTime = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const delay = BASE_INTERVAL_MS + Math.random() * JITTER_MS;
  const elapsed = now - lastRequestTime;
  if (elapsed < delay) {
    await new Promise((r) => setTimeout(r, delay - elapsed));
  }
  lastRequestTime = Date.now();
}

async function downloadFile(
  file: DOJFile,
  outputDir: string,
  progress: DownloadProgress,
  retries: number = 3,
  cookieHeader?: string,
): Promise<DownloadResult> {
  const filename = safeFilename(file.url);
  const dataSetDir = path.join(outputDir, `data-set-${file.dataSetId}`);
  fs.mkdirSync(dataSetDir, { recursive: true });

  const outputPath = path.join(dataSetDir, filename);

  // Resume support: if file exists and hash matches progress, skip
  if (fs.existsSync(outputPath) && progress.completed[file.url]) {
    const existingHash = await computeHash(outputPath);
    if (existingHash === progress.completed[file.url].hash) {
      return {
        url: file.url,
        success: true,
        localPath: outputPath,
        fileSizeBytes: progress.completed[file.url].bytes,
        fileHash: existingHash,
      };
    }
    // Hash mismatch — re-download
    fs.unlinkSync(outputPath);
  }

  if (progress.completed[file.url] && !fs.existsSync(outputPath)) {
    // Recorded as done but file missing — re-download
    delete progress.completed[file.url];
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await throttle();

      // Mimic a real browser click on a PDF link from the dataset listing page
      const dsNum = file.dataSetId;
      const referer = `https://www.justice.gov/epstein/doj-disclosures/data-set-${dsNum}-files`;
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/pdf,application/octet-stream,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: referer,
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
      };
      if (cookieHeader) {
        headers["Cookie"] = cookieHeader;
      }

      const response = await fetch(file.url, {
        headers,
        redirect: "follow",
      });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("retry-after") || "5", 10);
        console.warn(`  429 rate-limited on ${filename}, waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        console.warn(`  HTTP ${response.status} for ${filename} (attempt ${attempt}/${retries})`);
        if (attempt === retries) {
          return { url: file.url, success: false, error: `HTTP ${response.status}` };
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
      const usedStreaming = contentLength > STREAM_THRESHOLD && !!response.body;
      let downloadBuffer: Buffer | undefined;

      if (usedStreaming) {
        // Stream-based write for large files (videos, large PDFs)
        const nodeStream = Readable.fromWeb(response.body as any);
        const writeStream = fs.createWriteStream(outputPath);
        await pipeline(nodeStream, writeStream);
      } else {
        // Buffer-based write for smaller files — keep buffer for R2 reuse
        const arrayBuf = await response.arrayBuffer();
        downloadBuffer = Buffer.from(arrayBuf);
        fs.writeFileSync(outputPath, downloadBuffer);
      }

      const stat = fs.statSync(outputPath);
      const fileHash = await computeHash(outputPath);

      progress.completed[file.url] = {
        hash: fileHash,
        localPath: outputPath,
        bytes: stat.size,
      };
      progress.totalBytes += stat.size;

      console.log(
        `  Downloaded: ${filename} (${formatBytes(stat.size)}, sha256:${fileHash.substring(0, 12)}...)`,
      );

      // Upload to R2 if configured
      let r2Key: string | undefined;
      if (isR2Configured()) {
        try {
          const r2KeyPath = buildR2Key(file.dataSetId, filename);
          const uploadBody = usedStreaming
            ? fs.createReadStream(outputPath)
            : downloadBuffer!;
          await uploadToR2(r2KeyPath, uploadBody, guessMime(outputPath));
          r2Key = r2KeyPath;
          console.log(`  Uploaded to R2: ${r2KeyPath}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  R2 upload failed (non-fatal): ${msg}`);
        }
      }

      return {
        url: file.url,
        success: true,
        localPath: outputPath,
        fileSizeBytes: stat.size,
        fileHash,
        r2Key,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`  Error downloading ${filename}: ${msg} (attempt ${attempt}/${retries})`);
      if (attempt === retries) {
        return { url: file.url, success: false, error: msg };
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  return { url: file.url, success: false, error: "Exhausted retries" };
}

async function updateDocumentRecord(result: DownloadResult): Promise<void> {
  if (!result.success || !result.localPath) return;

  try {
    const existing = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.sourceUrl, result.url))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(documents)
        .set({
          localPath: result.localPath,
          fileSizeBytes: result.fileSizeBytes,
          fileHash: result.fileHash,
          processingStatus: "downloaded",
          mimeType: guessMime(result.localPath),
          r2Key: result.r2Key ?? null,
        })
        .where(eq(documents.id, existing[0].id));
    }
  } catch {
    // DB update is best-effort; download still succeeded
  }
}

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  return MIME_MAP[ext] || "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function downloadDocuments(options: {
  dataSetIds?: number[];
  fileTypes?: string[];
  maxFiles?: number;
  concurrency?: number;
  rateLimitMs?: number;
  retryFailed?: boolean;
}): Promise<void> {
  console.log("\n=== DOJ Document Downloader (Parallel) ===\n");

  const {
    dataSetIds,
    fileTypes,
    maxFiles = Infinity,
    concurrency = MAX_CONCURRENCY,
    retryFailed = false,
  } = options;

  if (!fs.existsSync(CATALOG_FILE)) {
    console.error("Error: No catalog found. Run the DOJ scraper first.");
    console.error("  npx tsx scripts/pipeline/doj-scraper.ts");
    return;
  }

  const catalog: DOJCatalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf-8"));
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  let files = catalog.dataSets.flatMap((ds) => ds.files);

  if (dataSetIds && dataSetIds.length > 0) {
    files = files.filter((f) => dataSetIds.includes(f.dataSetId));
  }

  if (fileTypes && fileTypes.length > 0) {
    files = files.filter((f) => fileTypes.includes(f.fileType.toLowerCase()));
  }

  files = files.slice(0, maxFiles);

  const progress = loadProgress();
  const failedSet = new Set(progress.failed);

  let pending: typeof files;
  if (retryFailed) {
    // Only retry previously failed URLs, clear them from the failed list
    pending = files.filter((f) => failedSet.has(f.url) && !progress.completed[f.url]);
    progress.failed = progress.failed.filter((url) => !pending.some((f) => f.url === url));
    console.log(`Retry mode: ${pending.length} previously failed URLs\n`);
  } else {
    // Normal mode: skip completed AND previously failed URLs
    pending = files.filter((f) => !progress.completed[f.url] && !failedSet.has(f.url));
  }

  console.log(`Total catalog files: ${files.length}`);
  console.log(`Already downloaded:  ${files.length - pending.length}`);
  console.log(`Remaining:           ${pending.length}`);
  console.log(`Concurrency:         ${concurrency} parallel downloads`);
  console.log(`Rate limit:          ~${(1000 / BASE_INTERVAL_MS).toFixed(1)} req/sec (with jitter)`);
  console.log(`Stream threshold:    ${formatBytes(STREAM_THRESHOLD)}`);
  console.log(`Output directory:    ${DOWNLOADS_DIR}\n`);

  if (pending.length === 0) {
    console.log("Nothing to download — all files already completed.");
    return;
  }

  // Obtain Akamai bot challenge cookies from the persistent Chrome profile.
  // Without these, DOJ returns 404 for all file downloads.
  let cookieHeader: string | undefined;
  try {
    console.log("Obtaining Akamai cookies from browser session...");
    await getBrowserContext();
    cookieHeader = await extractCookieHeader();
    await closeBrowser();
    if (cookieHeader) {
      console.log(`Cookie header obtained (${cookieHeader.length} chars)\n`);
    }
  } catch (err: any) {
    console.warn(`Warning: Could not obtain cookies (${err.message}). Downloads may fail.\n`);
  }

  const limit = pLimit(concurrency);
  let downloadedCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  const tasks = pending.map((file) =>
    limit(async () => {
      const result = await downloadFile(file, DOWNLOADS_DIR, progress, 3, cookieHeader);

      if (result.success) {
        downloadedCount++;
        await updateDocumentRecord(result);
      } else {
        failedCount++;
        if (!progress.failed.includes(file.url)) {
          progress.failed.push(file.url);
        }
      }

      // Periodic progress save (every 10 completions)
      if ((downloadedCount + failedCount) % 10 === 0) {
        saveProgress(progress);
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = downloadedCount / elapsed;
        console.log(
          `\n  Progress: ${downloadedCount}/${pending.length} downloaded, ${failedCount} failed` +
            ` | ${formatBytes(progress.totalBytes)} total | ${rate.toFixed(1)} files/sec\n`,
        );
      }

      return result;
    }),
  );

  const results = await Promise.all(tasks);
  saveProgress(progress);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n=== Download Summary ===");
  console.log(`Downloaded:    ${downloadedCount}`);
  console.log(`Failed:        ${failedCount}`);
  console.log(`Total size:    ${formatBytes(progress.totalBytes)}`);
  console.log(`Time elapsed:  ${elapsed}s`);
  console.log(`Progress file: ${PROGRESS_FILE}`);

  if (failedCount > 0) {
    console.log(`\nFailed URLs (${failedCount}):`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  ${r.url} — ${r.error}`);
    }
  }
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
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      options.concurrency = parseInt(args[++i], 10);
    } else if (args[i] === "--retry-failed") {
      options.retryFailed = true;
    }
  }

  downloadDocuments(options).catch(console.error);
}
