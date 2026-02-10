/**
 * Torrent-based downloader for Epstein Files data sets.
 *
 * Data origin: U.S. Department of Justice (justice.gov/epstein) — official public releases
 * Distribution: yung-megafone/Epstein-Files (github.com/yung-megafone/Epstein-Files) —
 *   community archive preserving publicly released materials via torrents after DOJ
 *   removed several data sets from their site (DS 9, 10, 11 unavailable since Feb 6, 2026).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import pLimit from "p-limit";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const STAGING_DIR = path.join(DATA_DIR, "torrent-staging");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const PROGRESS_FILE = path.join(DATA_DIR, "torrent-progress.json");

// DS 9 placeholder file sizes (known junk files)
const PLACEHOLDER_SIZES = new Set([4670, 2433]);

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".mp4",
  ".avi",
  ".mov",
  ".wmv",
  ".webm",
  ".m4a",
  ".wav",
  ".3gp",
  ".amr",
  ".opus",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TorrentConfig {
  magnetUri: string;
  format: "zip" | "tar.zst";
  expectedSizeGB: number;
  description: string;
  containedDataSets?: number[];
}

interface TorrentProgressState {
  status:
    | "downloading"
    | "downloaded"
    | "extracting"
    | "normalizing"
    | "complete"
    | "failed";
  downloadedBytes: number;
  extractedFiles: number;
  normalizedFiles: number;
  skippedPlaceholders: number;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

interface TorrentProgress {
  dataSets: Record<string, TorrentProgressState>;
  lastUpdated: string;
}

export interface TorrentResult {
  totalFiles: number;
  newFiles: number;
  skippedFiles: number;
  failedExtractions: number;
  bytesDownloaded: number;
}

// ---------------------------------------------------------------------------
// Magnet link config — sourced from github.com/yung-megafone/Epstein-Files
// ---------------------------------------------------------------------------

const TORRENT_CONFIG: Record<number | "full", TorrentConfig> = {
  9: {
    magnetUri:
      "magnet:?xt=urn:btih:7ac8f771678d19c75a26ea6c14e7d4c003fbf9b6&dn=dataset9-more-complete.tar.zst",
    format: "tar.zst",
    expectedSizeGB: 143,
    description: "DS 9 — High-value communications, emails, correspondence",
  },
  10: {
    magnetUri:
      "magnet:?xt=urn:btih:d509cc4ca1a415a9ba3b6cb920f67c44aed7fe1f&dn=DataSet%2010.zip",
    format: "zip",
    expectedSizeGB: 78.6,
    description: "DS 10 — Visual media (180K+ images, 2K+ videos)",
  },
  11: {
    magnetUri:
      "magnet:?xt=urn:btih:59975667f8bdd5baf9945b0e2db8a57d52d32957&dn=DataSet%2011.zip",
    format: "zip",
    expectedSizeGB: 25.5,
    description: "DS 11 — Financial ledgers, flight manifests",
  },
  full: {
    magnetUri:
      "magnet:?xt=urn:btih:f5cbe5026b1f86617c520d0a9cd610d6254cbe85&dn=epstein-files-structured-full-20250204.tar.zst&xl=221393230690",
    format: "tar.zst",
    expectedSizeGB: 206.18,
    description: "Full composite archive — All data sets 1-12",
    containedDataSets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
};

// Data sets that have individual magnets
const INDIVIDUAL_TORRENT_DS = new Set([9, 10, 11]);

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function loadProgress(): TorrentProgress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { dataSets: {}, lastUpdated: new Date().toISOString() };
}

function saveProgress(progress: TorrentProgress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractInfoHash(magnetUri: string): string {
  const match = magnetUri.match(/btih:([a-fA-F0-9]+)/);
  if (!match) throw new Error(`Cannot extract info hash from: ${magnetUri}`);
  return match[1].toLowerCase();
}

function inferDataSetId(relativePath: string): number | null {
  const match =
    relativePath.match(/(?:data[-_\s]?set[-_\s]?)(\d+)/i) ||
    relativePath.match(/\bDS[-_]?(\d+)\b/i) ||
    relativePath.match(/\bdataset(\d+)\b/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

async function checkAria2c(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("which", ["aria2c"]);
    return stdout.trim();
  } catch {
    throw new Error(
      "aria2c not found. Install with: brew install aria2 (macOS) or apt install aria2 (Linux)",
    );
  }
}

async function checkZstd(): Promise<void> {
  try {
    await execFileAsync("which", ["zstd"]);
  } catch {
    throw new Error(
      "zstd not found (needed for .tar.zst archives). Install with: brew install zstd (macOS) or apt install zstd (Linux)",
    );
  }
}

// ---------------------------------------------------------------------------
// Core pipeline functions
// ---------------------------------------------------------------------------

async function downloadViaMagnets(
  configs: { key: string; config: TorrentConfig }[],
  maxConcurrentDownloads: number,
  progress: TorrentProgress,
  stagingDir: string,
): Promise<void> {
  // Filter out already-downloaded torrents
  const toDownload = configs.filter((c) => {
    const hash = extractInfoHash(c.config.magnetUri);
    const state = progress.dataSets[hash];
    if (
      state &&
      state.status !== "downloading" &&
      state.status !== "failed"
    ) {
      console.log(`  Skipping ${c.key}: already ${state.status}`);
      return false;
    }
    return true;
  });

  if (toDownload.length === 0) {
    console.log("  All torrents already downloaded.\n");
    return;
  }

  // Write aria2c input file for batch downloading
  const inputFilePath = path.join(stagingDir, "magnets.txt");
  const lines: string[] = [];
  for (const { key, config } of toDownload) {
    const dsDir = path.join(stagingDir, key);
    fs.mkdirSync(dsDir, { recursive: true });
    lines.push(config.magnetUri);
    lines.push(`  dir=${dsDir}`);
  }
  fs.writeFileSync(inputFilePath, lines.join("\n") + "\n");

  // Initialize progress for each torrent
  for (const { config } of toDownload) {
    const hash = extractInfoHash(config.magnetUri);
    if (!progress.dataSets[hash]) {
      progress.dataSets[hash] = {
        status: "downloading",
        downloadedBytes: 0,
        extractedFiles: 0,
        normalizedFiles: 0,
        skippedPlaceholders: 0,
        startedAt: new Date().toISOString(),
      };
    } else {
      progress.dataSets[hash].status = "downloading";
      progress.dataSets[hash].error = undefined;
    }
  }
  saveProgress(progress);

  console.log(
    `  Starting aria2c with ${toDownload.length} magnet(s), max concurrent: ${maxConcurrentDownloads}`,
  );

  // Spawn aria2c
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "aria2c",
      [
        `--input-file=${inputFilePath}`,
        `--max-concurrent-downloads=${maxConcurrentDownloads}`,
        "--seed-time=0",
        "--bt-stop-timeout=600",
        "--summary-interval=30",
        "--file-allocation=falloc",
        "--console-log-level=notice",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    proc.stdout.on("data", (data: Buffer) => {
      process.stdout.write(data);
    });
    proc.stderr.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`aria2c exited with code ${code}`));
      }
    });
    proc.on("error", reject);
  });

  // Mark all as downloaded
  for (const { config } of toDownload) {
    const hash = extractInfoHash(config.magnetUri);
    progress.dataSets[hash].status = "downloaded";

    // Estimate downloaded bytes from staging dir
    const dsDir = path.join(
      stagingDir,
      toDownload.find((t) => extractInfoHash(t.config.magnetUri) === hash)!
        .key,
    );
    const files = walkDir(dsDir);
    let totalBytes = 0;
    for (const f of files) {
      try {
        totalBytes += fs.statSync(f).size;
      } catch {
        // skip
      }
    }
    progress.dataSets[hash].downloadedBytes = totalBytes;
  }
  saveProgress(progress);
}

async function extractTarZst(
  archivePath: string,
  outputDir: string,
): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    // Try tar with --zstd flag first (GNU tar >= 1.31)
    await execFileAsync("tar", ["--zstd", "-xf", archivePath, "-C", outputDir]);
  } catch (err: any) {
    const stderr = err.stderr?.toString() || err.message || "";
    const isUnsupportedFlag =
      stderr.includes("unknown option") ||
      stderr.includes("unrecognized option") ||
      stderr.includes("illegal option");
    if (!isUnsupportedFlag) {
      throw err;
    }
    // Fallback: pipe zstd decompressor into tar
    console.log(
      "  tar --zstd not supported, falling back to zstd | tar pipe...",
    );
    await new Promise<void>((resolve, reject) => {
      const zstdProc = spawn("zstd", ["-d", "--stdout", archivePath]);
      const tarProc = spawn("tar", ["-xf", "-", "-C", outputDir]);
      let zstdExitCode: number | null = null;

      zstdProc.stdout.pipe(tarProc.stdin);
      zstdProc.stderr.on("data", (d: Buffer) => process.stderr.write(d));
      tarProc.stderr.on("data", (d: Buffer) => process.stderr.write(d));

      zstdProc.on("close", (code) => {
        zstdExitCode = code;
        if (code !== 0) {
          tarProc.kill();
          reject(new Error(`zstd exited with code ${code}`));
        }
      });
      tarProc.on("close", (code) => {
        if (zstdExitCode !== null && zstdExitCode !== 0) return; // already rejected
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`tar exited with code ${code}`));
        }
      });
      zstdProc.on("error", reject);
      tarProc.on("error", reject);
    });
  }
}

async function extractZip(
  archivePath: string,
  outputDir: string,
): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  await execFileAsync("unzip", ["-o", "-q", archivePath, "-d", outputDir]);
}

async function extractArchive(
  stagingDir: string,
  key: string,
  config: TorrentConfig,
  progress: TorrentProgress,
): Promise<string> {
  const hash = extractInfoHash(config.magnetUri);
  const state = progress.dataSets[hash];

  if (!state) {
    throw new Error(`No progress entry for ${key} (hash: ${hash})`);
  }

  // If already extracted or further along, skip
  if (
    state.status !== "downloaded" &&
    state.status !== "extracting" &&
    state.status !== "failed"
  ) {
    console.log(`  Skipping extraction for ${key}: already ${state.status}`);
    return path.join(stagingDir, `${key}-extracted`);
  }

  const extractDir = path.join(stagingDir, `${key}-extracted`);

  // If previously failed during extraction, clean up and retry
  if (state.status === "extracting" || state.status === "failed") {
    if (fs.existsSync(extractDir)) {
      console.log(`  Cleaning up partial extraction for ${key}...`);
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }

  state.status = "extracting";
  saveProgress(progress);

  // Find archive files in the staging directory
  const dsDir = path.join(stagingDir, key);
  const allFiles = walkDir(dsDir);

  console.log(`  Extracting ${key} (${config.format})...`);

  let extracted = 0;
  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();

    if (config.format === "zip" && ext === ".zip") {
      await extractZip(filePath, extractDir);
      extracted++;
    } else if (
      config.format === "tar.zst" &&
      (filePath.endsWith(".tar.zst") || filePath.endsWith(".tar"))
    ) {
      if (filePath.endsWith(".tar.zst")) {
        await extractTarZst(filePath, extractDir);
      } else {
        await execFileAsync("tar", ["-xf", filePath, "-C", extractDir]);
      }
      extracted++;
    }
  }

  // If no archives found, the download itself may be a directory of files
  if (extracted === 0) {
    console.log(
      `  No archives found in ${key} staging dir — treating files as already extracted`,
    );
    // Symlink or use the staging dir as the "extracted" dir
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
      // Copy files instead of symlinking for consistency
      for (const f of allFiles) {
        const rel = path.relative(dsDir, f);
        const dest = path.join(extractDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(f, dest);
      }
    }
  }

  const extractedFiles = walkDir(extractDir);
  state.extractedFiles = extractedFiles.length;
  state.status = "normalizing";
  saveProgress(progress);

  console.log(`  Extracted ${extractedFiles.length} files from ${key}`);
  return extractDir;
}

async function normalizeFiles(
  extractedDir: string,
  dataSetId: number | null,
  key: string,
  config: TorrentConfig,
  progress: TorrentProgress,
  outputDir: string,
): Promise<{ moved: number; skipped: number; placeholders: number }> {
  const hash = extractInfoHash(config.magnetUri);
  const state = progress.dataSets[hash];

  if (!state) {
    throw new Error(`No progress entry for ${key} (hash: ${hash})`);
  }

  const allFiles = walkDir(extractedDir);
  const supportedFiles = allFiles.filter((f) =>
    SUPPORTED_EXTENSIONS.has(path.extname(f).toLowerCase()),
  );

  const limit = pLimit(20);
  let moved = 0;
  let skipped = 0;
  let placeholders = 0;

  // Track reserved destination paths in memory to prevent TOCTOU race
  // conditions when concurrent tasks target the same filename.
  const reservedPaths = new Set<string>();

  console.log(
    `  Normalizing ${supportedFiles.length} supported files from ${key}...`,
  );

  await Promise.all(
    supportedFiles.map((srcPath) =>
      limit(async () => {
        try {
          // Determine data set ID
          let dsNum = dataSetId;
          if (dsNum === null) {
            // Composite archive — infer from path
            const relativePath = path.relative(extractedDir, srcPath);
            dsNum = inferDataSetId(relativePath);
            if (dsNum === null) {
              return; // Cannot determine data set — skip
            }
          }

          const stat = fs.statSync(srcPath);

          // Skip DS 9 placeholder files
          if (dsNum === 9 && PLACEHOLDER_SIZES.has(stat.size)) {
            placeholders++;
            return;
          }

          const targetDir = path.join(outputDir, `data-set-${dsNum}`);
          fs.mkdirSync(targetDir, { recursive: true });

          let destPath = path.join(targetDir, path.basename(srcPath));

          // Handle filename collisions: check both on-disk files and
          // paths reserved by concurrent tasks (prevents TOCTOU races)
          if (fs.existsSync(destPath) || reservedPaths.has(destPath)) {
            if (fs.existsSync(destPath)) {
              try {
                const destStat = fs.statSync(destPath);
                if (destStat.size === stat.size) {
                  skipped++;
                  return;
                }
              } catch {
                // If stat fails, fall through to collision handling
              }
            }

            // Different file exists or path reserved — disambiguate
            const ext = path.extname(destPath);
            const base = path.basename(destPath, ext);
            let counter = 1;
            while (
              fs.existsSync(destPath) ||
              reservedPaths.has(destPath)
            ) {
              destPath = path.join(targetDir, `${base}_${counter}${ext}`);
              counter++;
            }
          }

          // Reserve the path synchronously before the async copy
          reservedPaths.add(destPath);

          await fs.promises.copyFile(srcPath, destPath);
          moved++;
        } catch (err: any) {
          console.warn(
            `  Warning: Failed to normalize ${path.basename(srcPath)}: ${err.message}`,
          );
        }
      }),
    ),
  );

  state.normalizedFiles = moved;
  state.skippedPlaceholders = placeholders;
  state.status = "complete";
  state.completedAt = new Date().toISOString();
  saveProgress(progress);

  console.log(
    `  ${key}: ${moved} files normalized, ${skipped} skipped (existing), ${placeholders} placeholders filtered`,
  );

  return { moved, skipped, placeholders };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function downloadTorrents(options?: {
  dataSetIds?: number[];
  maxConcurrentDownloads?: number;
  stagingDir?: string;
  outputDir?: string;
}): Promise<TorrentResult> {
  console.log("\n=== Torrent Downloader (aria2c) ===\n");

  const {
    dataSetIds,
    maxConcurrentDownloads = 3,
    stagingDir = STAGING_DIR,
    outputDir = DOWNLOADS_DIR,
  } = options || {};

  // Fail fast: check prerequisites
  const aria2cPath = await checkAria2c();
  console.log(`  aria2c: ${aria2cPath}`);

  // Determine which torrents to download
  const torrentsToProcess: { key: string; config: TorrentConfig; dsId: number | null }[] = [];
  let needsZstd = false;

  if (!dataSetIds || dataSetIds.length === 0) {
    // Download all via the full composite archive (contains DS 1-12, ~206 GB)
    torrentsToProcess.push({
      key: "full",
      config: TORRENT_CONFIG.full,
      dsId: null,
    });
    needsZstd = true; // full archive is tar.zst
  } else {
    // Check which individual torrents we have, which need composite
    const needComposite: number[] = [];

    for (const dsId of dataSetIds) {
      if (INDIVIDUAL_TORRENT_DS.has(dsId)) {
        const cfg = TORRENT_CONFIG[dsId as 9 | 10 | 11];
        torrentsToProcess.push({ key: `ds-${dsId}`, config: cfg, dsId });
        if (cfg.format === "tar.zst") needsZstd = true;
      } else if (dsId >= 1 && dsId <= 12) {
        needComposite.push(dsId);
      } else {
        console.warn(`  Unknown data set ID: ${dsId} — skipping`);
      }
    }

    if (needComposite.length > 0) {
      console.log(
        `  Data sets ${needComposite.join(", ")} require the full composite archive torrent`,
      );
      torrentsToProcess.push({
        key: "full",
        config: TORRENT_CONFIG.full,
        dsId: null,
      });
      needsZstd = true;
    }
  }

  // Check zstd if needed
  if (needsZstd) {
    await checkZstd();
  }

  if (torrentsToProcess.length === 0) {
    console.log("  No torrents to process.\n");
    return {
      totalFiles: 0,
      newFiles: 0,
      skippedFiles: 0,
      failedExtractions: 0,
      bytesDownloaded: 0,
    };
  }

  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const progress = loadProgress();
  const result: TorrentResult = {
    totalFiles: 0,
    newFiles: 0,
    skippedFiles: 0,
    failedExtractions: 0,
    bytesDownloaded: 0,
  };

  console.log(`  Torrents to process: ${torrentsToProcess.length}`);
  for (const { key, config } of torrentsToProcess) {
    console.log(
      `    ${key}: ${config.description} (~${config.expectedSizeGB} GB, ${config.format})`,
    );
  }
  console.log("");

  // Phase 1: Download all torrents via aria2c
  console.log("Phase 1: Downloading via aria2c...\n");
  try {
    await downloadViaMagnets(
      torrentsToProcess.map(({ key, config }) => ({ key, config })),
      maxConcurrentDownloads,
      progress,
      stagingDir,
    );
  } catch (err: any) {
    console.error(`  aria2c download failed: ${err.message}`);
    // Mark all as failed if aria2c crashes
    for (const { config } of torrentsToProcess) {
      const hash = extractInfoHash(config.magnetUri);
      if (progress.dataSets[hash]?.status === "downloading") {
        progress.dataSets[hash].status = "failed";
        progress.dataSets[hash].error = err.message;
        result.failedExtractions++;
      }
    }
    saveProgress(progress);
  }

  // Phase 2: Extract archives in parallel
  console.log("\nPhase 2: Extracting archives...\n");
  const extractLimit = pLimit(3);
  const extractionResults = await Promise.all(
    torrentsToProcess.map(({ key, config, dsId }) =>
      extractLimit(async () => {
        const hash = extractInfoHash(config.magnetUri);
        const state = progress.dataSets[hash];
        if (!state || state.status === "failed") {
          console.log(`  Skipping extraction for ${key}: download failed`);
          return null;
        }
        try {
          const extractedDir = await extractArchive(
            stagingDir,
            key,
            config,
            progress,
          );
          return { key, config, dsId, extractedDir };
        } catch (err: any) {
          console.error(`  Extraction failed for ${key}: ${err.message}`);
          const hash2 = extractInfoHash(config.magnetUri);
          progress.dataSets[hash2].status = "failed";
          progress.dataSets[hash2].error = `Extraction: ${err.message}`;
          saveProgress(progress);
          result.failedExtractions++;
          return null;
        }
      }),
    ),
  );

  // Phase 3: Normalize files
  console.log("\nPhase 3: Normalizing files...\n");
  for (const item of extractionResults) {
    if (!item) continue;
    const { key, config, dsId, extractedDir } = item;
    try {
      const { moved, skipped, placeholders } = await normalizeFiles(
        extractedDir,
        dsId,
        key,
        config,
        progress,
        outputDir,
      );
      result.newFiles += moved;
      result.skippedFiles += skipped;
      result.totalFiles += moved + skipped + placeholders;
    } catch (err: any) {
      console.error(`  Normalization failed for ${key}: ${err.message}`);
      const hash = extractInfoHash(config.magnetUri);
      progress.dataSets[hash].status = "failed";
      progress.dataSets[hash].error = `Normalization: ${err.message}`;
      saveProgress(progress);
    }
  }

  // Calculate bytes downloaded for this run's torrents only
  for (const { config } of torrentsToProcess) {
    const hash = extractInfoHash(config.magnetUri);
    const state = progress.dataSets[hash];
    if (state) {
      result.bytesDownloaded += state.downloadedBytes;
    }
  }

  saveProgress(progress);

  // Summary
  console.log("\n=== Torrent Download Summary ===");
  console.log(`  Total files found:      ${result.totalFiles}`);
  console.log(`  New files normalized:   ${result.newFiles}`);
  console.log(`  Skipped (existing):     ${result.skippedFiles}`);
  console.log(`  Failed extractions:     ${result.failedExtractions}`);
  console.log(`  Bytes downloaded:       ${formatBytes(result.bytesDownloaded)}`);
  console.log(`  Progress file:          ${PROGRESS_FILE}\n`);

  return result;
}

// ---------------------------------------------------------------------------
// Standalone CLI
// ---------------------------------------------------------------------------

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof downloadTorrents>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data-sets" && args[i + 1]) {
      options.dataSetIds = args[++i].split(",").map(Number);
    } else if (args[i] === "--max-concurrent" && args[i + 1]) {
      options.maxConcurrentDownloads = parseInt(args[++i], 10);
    } else if (args[i] === "--staging-dir" && args[i + 1]) {
      options.stagingDir = args[++i];
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      options.outputDir = args[++i];
    }
  }

  downloadTorrents(options).catch((err) => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
