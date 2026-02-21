/**
 * Extension Resolver — determines the true file type of DOJ URLs mislabeled as .pdf
 *
 * The DOJ Epstein archive serves URLs with .pdf extensions even when the underlying
 * file is video, audio, image, or other media. This script strips the .pdf extension,
 * probes all candidate extensions via HEAD requests, and verifies with magic bytes.
 * Optionally downloads the resolved files.
 *
 * Uses Playwright's context.request API to carry the browser's full Akamai session
 * (cookies + TLS fingerprint) with every request, avoiding brittle cookie extraction.
 *
 * Usage:
 *   npx tsx scripts/pipeline/extension-resolver.ts data/no-images-produced.csv
 *   npx tsx scripts/pipeline/extension-resolver.ts data/no-images-produced.csv --download
 *   npx tsx scripts/pipeline/extension-resolver.ts data/no-images-produced.csv --download-only
 *   npx tsx scripts/pipeline/extension-resolver.ts data/no-images-produced.csv --headed
 *   npx tsx scripts/pipeline/extension-resolver.ts data/no-images-produced.csv --concurrency 4
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import pLimit from "p-limit";
import type { BrowserContext } from "playwright";
import { getBrowserContext, extractCookieHeader, closeBrowser } from "./doj-scraper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const DEFAULT_OUTPUT = path.join(DATA_DIR, "resolved.partial.csv");

// ===== CONFIGURATION =====

const BASE_INTERVAL_MS = 1500;
const JITTER_MS = 1000;
const DEFAULT_CONCURRENCY = 2;
const BOT_BLOCK_PAUSE_MS = 60_000;
const BOT_BLOCK_THRESHOLD = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SESSION_REFRESHES = 3;

// Download mode
const RESOLVED_DOWNLOADS_DIR = path.join(DATA_DIR, "downloads", "resolved");
const RESOLVED_PROGRESS_FILE = path.join(DATA_DIR, "resolved-download-progress.json");
const DOWNLOAD_CONCURRENCY = 2;
const DOWNLOAD_RETRIES = 3;
const STREAM_THRESHOLD = 10 * 1024 * 1024; // 10MB

// ===== EXTENSION TIERS =====
// Media-first because the input set is "no images produced" — likely media files

const PROBE_TIERS: string[][] = [
  // Tier 1: Most likely for media files
  ["mov", "mp4", "m4a", "mp3", "jpg", "jpeg", "png", "avi", "wav", "3gp", "wmv"],
  // Tier 2: Other media formats
  ["ogg", "opus", "webm", "flac", "aac", "wma", "gif", "mkv", "flv", "bmp", "tiff", "webp"],
  // Tier 3: Documents
  ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv"],
  // Tier 4: Archives
  ["zip", "rar", "7z"],
  // Tier 5: Original (check last)
  ["pdf"],
];

const ALL_EXTENSIONS = PROBE_TIERS.flat();

// ===== MAGIC BYTE SIGNATURES =====

interface MagicSignature {
  offset: number;
  bytes: number[];
  ext: string;
  mime: string;
  category: string;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  // PDF
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], ext: "pdf", mime: "application/pdf", category: "pdf" },
  // JPEG
  { offset: 0, bytes: [0xFF, 0xD8, 0xFF], ext: "jpg", mime: "image/jpeg", category: "image" },
  // PNG
  { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], ext: "png", mime: "image/png", category: "image" },
  // GIF87a
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], ext: "gif", mime: "image/gif", category: "image" },
  // GIF89a
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], ext: "gif", mime: "image/gif", category: "image" },
  // BMP
  { offset: 0, bytes: [0x42, 0x4D], ext: "bmp", mime: "image/bmp", category: "image" },
  // TIFF (little-endian)
  { offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00], ext: "tiff", mime: "image/tiff", category: "image" },
  // TIFF (big-endian)
  { offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A], ext: "tiff", mime: "image/tiff", category: "image" },
  // MP4/MOV/M4A/3GP (ftyp container)
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], ext: "mp4", mime: "video/mp4", category: "video" },
  // RIFF container (AVI/WAV/WebP — disambiguated by bytes 8-11)
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], ext: "riff", mime: "varies", category: "varies" },
  // ZIP-based (ZIP/DOCX/XLSX/PPTX)
  { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04], ext: "zip", mime: "application/zip", category: "archive" },
  // OLE2 (DOC/XLS/PPT)
  { offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], ext: "ole", mime: "application/x-ole-storage", category: "document" },
  // MP3 with ID3 tag
  { offset: 0, bytes: [0x49, 0x44, 0x33], ext: "mp3", mime: "audio/mpeg", category: "audio" },
  // MP3 sync word (MPEG1 Layer 3)
  { offset: 0, bytes: [0xFF, 0xFB], ext: "mp3", mime: "audio/mpeg", category: "audio" },
  // MP3 sync word (MPEG2 Layer 3)
  { offset: 0, bytes: [0xFF, 0xF3], ext: "mp3", mime: "audio/mpeg", category: "audio" },
  // MP3 sync word (MPEG2.5 Layer 3)
  { offset: 0, bytes: [0xFF, 0xF2], ext: "mp3", mime: "audio/mpeg", category: "audio" },
  // Ogg (OggS)
  { offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53], ext: "ogg", mime: "audio/ogg", category: "audio" },
  // FLAC (fLaC)
  { offset: 0, bytes: [0x66, 0x4C, 0x61, 0x43], ext: "flac", mime: "audio/flac", category: "audio" },
  // MKV/WebM (EBML)
  { offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3], ext: "mkv", mime: "video/x-matroska", category: "video" },
  // ASF header (WMV/WMA)
  { offset: 0, bytes: [0x30, 0x26, 0xB2, 0x75], ext: "wmv", mime: "video/x-ms-wmv", category: "video" },
  // FLV
  { offset: 0, bytes: [0x46, 0x4C, 0x56, 0x01], ext: "flv", mime: "video/x-flv", category: "video" },
  // RAR
  { offset: 0, bytes: [0x52, 0x61, 0x72, 0x21], ext: "rar", mime: "application/x-rar-compressed", category: "archive" },
  // 7-Zip
  { offset: 0, bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], ext: "7z", mime: "application/x-7z-compressed", category: "archive" },
];

// ===== TYPES =====

interface ProbeResult {
  url: string;
  ext: string;
  contentType: string;
  contentLength: number;
  magicExt: string | null;
  magicMime: string | null;
  magicCategory: string | null;
  notes: string;
}

interface CsvRow {
  base_id: string;
  original_url: string;
  base_url: string;
  status: string;
  resolved_url: string;
  extension: string;
  file_type: string;
  content_type: string;
  content_length: number;
  notes: string;
}

// ===== RATE LIMITING =====
// Uses slot reservation to avoid burst behavior with concurrent tasks.
// Each caller atomically reserves a future time slot before awaiting.

let nextAllowedTime = 0;

async function throttle(): Promise<void> {
  const delay = BASE_INTERVAL_MS + Math.random() * JITTER_MS;
  const now = Date.now();
  const waitUntil = Math.max(now, nextAllowedTime);
  nextAllowedTime = waitUntil + delay;
  const sleepMs = waitUntil - now;
  if (sleepMs > 0) {
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

// ===== SESSION MANAGEMENT =====
// Instead of extracting cookies for Node fetch(), we keep the browser context open
// and use context.request which carries the full Akamai session automatically.

let sessionRefreshPromise: Promise<void> | null = null;
let lastSessionRefreshTime = 0;
const SESSION_REFRESH_COOLDOWN_MS = 30_000;

async function refreshSession(context: BrowserContext): Promise<void> {
  const now = Date.now();

  if (sessionRefreshPromise) {
    await sessionRefreshPromise;
    return;
  }

  if (now - lastSessionRefreshTime < SESSION_REFRESH_COOLDOWN_MS) {
    return;
  }

  sessionRefreshPromise = (async () => {
    try {
      console.log("\n  Session expired — navigating to re-authenticate with Akamai...");
      // Navigate to a file URL to trigger Akamai's challenge/verification
      const page = await context.newPage();
      try {
        await page.goto("https://www.justice.gov/epstein/files/DataSet%201/EFTA00003159.pdf", {
          waitUntil: "load",
          timeout: 30000,
        });
        // Wait for Akamai's invisible JS to complete
        await page.waitForTimeout(5000);

        // Check if we got authorization cookies
        const cookies = await context.cookies();
        const hasAuth = cookies.some(c => c.name.startsWith("authorization_"));

        if (!hasAuth) {
          const USE_HEADED = process.env.DOJ_HEADED === "1" || process.argv.includes("--headed");
          if (USE_HEADED) {
            console.log("  >>> Please solve the bot challenge in the browser window <<<");
            console.log("  Waiting up to 120s for authorization cookies...");
            const deadline = Date.now() + 120_000;
            while (Date.now() < deadline) {
              await page.waitForTimeout(3000);
              const updated = await context.cookies();
              if (updated.some(c => c.name.startsWith("authorization_"))) {
                console.log("  Akamai cookies obtained after manual solve!");
                break;
              }
            }
          }
        } else {
          console.log("  Akamai session refreshed successfully.\n");
        }
      } finally {
        await page.close();
      }
      lastSessionRefreshTime = Date.now();
    } catch (err: any) {
      console.warn(`  Session refresh failed: ${err.message}`);
    }
  })();

  try {
    await sessionRefreshPromise;
  } finally {
    sessionRefreshPromise = null;
  }
}

// ===== MAGIC BYTE DETECTION =====

function matchMagicBytes(buf: Buffer): { ext: string; mime: string; category: string } | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.offset + sig.bytes.length > buf.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buf[sig.offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    // Disambiguate RIFF container (bytes 8-11)
    if (sig.ext === "riff" && buf.length >= 12) {
      const riffType = buf.subarray(8, 12).toString("ascii");
      if (riffType === "AVI ") return { ext: "avi", mime: "video/x-msvideo", category: "video" };
      if (riffType === "WAVE") return { ext: "wav", mime: "audio/wav", category: "audio" };
      if (riffType === "WEBP") return { ext: "webp", mime: "image/webp", category: "image" };
      return { ext: "riff", mime: "application/octet-stream", category: "other" };
    }

    // Disambiguate ftyp container (bytes 8-11)
    if (sig.ext === "mp4" && sig.offset === 4 && buf.length >= 12) {
      const brand = buf.subarray(8, 12).toString("ascii");
      if (brand.startsWith("qt")) return { ext: "mov", mime: "video/quicktime", category: "video" };
      if (brand === "M4A " || brand === "M4B ") return { ext: "m4a", mime: "audio/mp4", category: "audio" };
      if (brand.startsWith("3gp")) return { ext: "3gp", mime: "video/3gpp", category: "video" };
      // isom, mp41, mp42, avc1, dash etc → mp4
      return { ext: "mp4", mime: "video/mp4", category: "video" };
    }

    return { ext: sig.ext, mime: sig.mime, category: sig.category };
  }

  return null;
}

function classifyExtension(ext: string): string {
  const videoExts = new Set(["mp4", "mov", "avi", "mkv", "wmv", "webm", "flv", "3gp", "mpg", "mpeg"]);
  const audioExts = new Set(["mp3", "m4a", "ogg", "opus", "wav", "flac", "aac", "wma"]);
  const imageExts = new Set(["jpg", "jpeg", "png", "gif", "bmp", "tiff", "webp"]);
  const archiveExts = new Set(["zip", "rar", "7z", "tar", "gz"]);
  const docExts = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "ole"]);

  if (ext === "pdf") return "pdf";
  if (videoExts.has(ext)) return "video";
  if (audioExts.has(ext)) return "audio";
  if (imageExts.has(ext)) return "image";
  if (archiveExts.has(ext)) return "archive";
  if (docExts.has(ext)) return "document";
  return "other";
}

// ===== HTTP PROBING (via Playwright context.request) =====

const PROBE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/octet-stream, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
};

async function probeExtension(
  context: BrowserContext,
  baseUrl: string,
  ext: string,
): Promise<ProbeResult | null> {
  const url = `${baseUrl}.${ext}`;

  try {
    // Step 1: HEAD request via Playwright (carries browser's full Akamai session)
    const headResp = await context.request.head(url, {
      headers: PROBE_HEADERS,
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (headResp.status() === 401 || headResp.status() === 403) {
      throw new Error(`${headResp.status()}`);
    }

    if (headResp.status() !== 200) return null;

    const contentType = headResp.headers()["content-type"] || "";
    const contentLength = parseInt(headResp.headers()["content-length"] || "0", 10);

    // Any text/html 200 on a file URL is a bot challenge or soft-404.
    if (contentType.includes("text/html")) {
      return { url, ext, contentType, contentLength, magicExt: null, magicMime: null, magicCategory: null, notes: "bot_challenge" };
    }

    // Step 2: Range request for magic bytes (first 16 bytes)
    let magicBytes: Buffer | null = null;
    try {
      const rangeResp = await context.request.fetch(url, {
        method: "GET",
        headers: { ...PROBE_HEADERS, Range: "bytes=0-15" },
        timeout: REQUEST_TIMEOUT_MS,
      });

      if (rangeResp.ok() || rangeResp.status() === 206) {
        magicBytes = Buffer.from(await rangeResp.body());
      }
    } catch {
      // Range not supported — proceed without magic byte verification
    }

    const detected = magicBytes ? matchMagicBytes(magicBytes) : null;
    let notes = "confirmed";
    if (!detected) {
      notes = magicBytes ? "unknown_magic" : "no_range_support";
    } else if (detected.ext !== ext) {
      notes = `magic_says_${detected.ext}`;
    }

    return {
      url,
      ext,
      contentType,
      contentLength,
      magicExt: detected?.ext ?? null,
      magicMime: detected?.mime ?? null,
      magicCategory: detected?.category ?? null,
      notes,
    };
  } catch (err: any) {
    if (err.message === "401" || err.message === "403") throw err;
    return null;
  }
}

// ===== CSV I/O =====

const CSV_HEADER =
  "base_id,original_url,base_url,status,resolved_url,extension,file_type,content_type,content_length,notes";

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsv(row: CsvRow): string {
  return [
    row.base_id,
    escapeCsvField(row.original_url),
    escapeCsvField(row.base_url),
    row.status,
    escapeCsvField(row.resolved_url),
    row.extension,
    row.file_type,
    escapeCsvField(row.content_type),
    String(row.content_length),
    escapeCsvField(row.notes),
  ].join(",");
}

function loadResolvedIds(outputPath: string): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync(outputPath)) return ids;

  const content = fs.readFileSync(outputPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const firstComma = lines[i].indexOf(",");
    if (firstComma > 0) {
      ids.add(lines[i].substring(0, firstComma));
    }
  }
  return ids;
}

function initOutputCsv(outputPath: string): void {
  if (!fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, CSV_HEADER + "\n");
  }
}

function appendRow(outputPath: string, row: CsvRow): void {
  fs.appendFileSync(outputPath, rowToCsv(row) + "\n");
}

// ===== INPUT PARSING =====

function loadInputUrls(csvPath: string): string[] {
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Skip header line if it doesn't start with http
  const startIdx = lines[0]?.toLowerCase().startsWith("http") ? 0 : 1;
  return lines.slice(startIdx).filter((l) => l.startsWith("http"));
}

function extractBaseId(url: string): string {
  const filename = url.split("/").pop() || "";
  return filename.replace(/\.[^.]+$/, "");
}

// ===== MAIN RESOLVER =====

async function resolveUrl(context: BrowserContext, baseUrl: string): Promise<{
  status: string;
  resolved_url: string;
  extension: string;
  file_type: string;
  content_type: string;
  content_length: number;
  notes: string;
}> {
  let consecutiveBotBlocks = 0;
  let sessionRefreshes = 0;
  const baseId = baseUrl.split("/").pop() || "";

  for (let i = 0; i < ALL_EXTENSIONS.length; i++) {
    const ext = ALL_EXTENSIONS[i];
    await throttle();

    try {
      const result = await probeExtension(context, baseUrl, ext);

      if (result && result.notes === "bot_challenge") {
        consecutiveBotBlocks++;
        if (consecutiveBotBlocks === 1) {
          console.log(`    ${baseId}: bot challenge on .${ext}`);
        }
        if (consecutiveBotBlocks >= BOT_BLOCK_THRESHOLD) {
          if (sessionRefreshes >= MAX_SESSION_REFRESHES) {
            console.log(`    ${baseId}: giving up after ${MAX_SESSION_REFRESHES} session refreshes — marking as bot_blocked`);
            return {
              status: "bot_blocked",
              resolved_url: "",
              extension: "",
              file_type: "",
              content_type: "",
              content_length: 0,
              notes: `bot_blocked_after_${sessionRefreshes}_refreshes`,
            };
          }
          console.log(`    ${baseId}: ${BOT_BLOCK_THRESHOLD} consecutive bot blocks — pausing ${BOT_BLOCK_PAUSE_MS / 1000}s and refreshing session...`);
          await new Promise((r) => setTimeout(r, BOT_BLOCK_PAUSE_MS));
          await refreshSession(context);
          sessionRefreshes++;
          consecutiveBotBlocks = 0;
          i--; // retry this extension
          continue;
        }
        continue;
      }

      consecutiveBotBlocks = 0;

      if (result) {
        const resolvedExt = result.magicExt ?? ext;
        const fileType = result.magicCategory
          ? result.magicCategory
          : classifyExtension(resolvedExt);

        return {
          status: "resolved",
          resolved_url: result.url,
          extension: resolvedExt,
          file_type: fileType,
          content_type: result.contentType,
          content_length: result.contentLength,
          notes: result.notes,
        };
      }
    } catch (err: any) {
      if (err.message === "401" || err.message === "403") {
        if (sessionRefreshes >= MAX_SESSION_REFRESHES) {
          return {
            status: "bot_blocked",
            resolved_url: "",
            extension: "",
            file_type: "",
            content_type: "",
            content_length: 0,
            notes: `auth_failed_after_${sessionRefreshes}_refreshes`,
          };
        }
        console.log(`    ${baseId}: HTTP ${err.message} on .${ext} — refreshing session`);
        await refreshSession(context);
        sessionRefreshes++;
        i--; // retry this extension
        continue;
      }
      // Other errors — skip this extension
    }
  }

  return {
    status: "not_found",
    resolved_url: "",
    extension: "",
    file_type: "",
    content_type: "",
    content_length: 0,
    notes: "probed_all_extensions",
  };
}

async function resolveExtensions(inputCsvPath: string, outputPath: string, concurrency: number): Promise<void> {
  console.log("\n=== DOJ Extension Resolver ===\n");
  console.log(`Extensions to probe: ${ALL_EXTENSIONS.length} per URL`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Output: ${outputPath}\n`);

  // 1. Load input URLs
  const urls = loadInputUrls(inputCsvPath);
  console.log(`Loaded ${urls.length} URLs from ${inputCsvPath}`);

  // 2. Load existing progress
  initOutputCsv(outputPath);
  const resolved = loadResolvedIds(outputPath);
  console.log(`Already resolved: ${resolved.size} URLs`);

  // 3. Filter to pending
  const pending = urls.filter((u) => !resolved.has(extractBaseId(u)));
  console.log(`Remaining: ${pending.length} URLs\n`);

  if (pending.length === 0) {
    console.log("All URLs already resolved.");
    return;
  }

  // 4. Open browser and establish Akamai session.
  // The browser context stays open for the entire run — context.request carries
  // the browser's full session (cookies, TLS fingerprint) with every request.
  console.log("Opening browser and establishing Akamai session...");
  const context = await getBrowserContext();

  // Navigate to trigger Akamai's challenge/verification flow
  const page = await context.newPage();
  try {
    await page.goto("https://www.justice.gov/epstein/files/DataSet%201/EFTA00003159.pdf", {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.waitForTimeout(5000); // Let Akamai's invisible JS complete

    // Check for authorization cookies
    let cookies = await context.cookies();
    let hasAuth = cookies.some(c => c.name.startsWith("authorization_"));

    if (!hasAuth) {
      const USE_HEADED = process.env.DOJ_HEADED === "1" || process.argv.includes("--headed");
      if (USE_HEADED) {
        console.log("  Akamai cookies not found after auto-solve.");
        console.log("  >>> Please solve the bot challenge in the browser window <<<");
        console.log("  Waiting up to 120s for authorization cookies...");
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          await page.waitForTimeout(3000);
          cookies = await context.cookies();
          hasAuth = cookies.some(c => c.name.startsWith("authorization_"));
          if (hasAuth) {
            console.log("  Akamai cookies obtained!\n");
            break;
          }
        }
      }
    }

    if (hasAuth) {
      console.log("  Akamai session established.\n");
    } else {
      console.log("  No authorization cookies found — will try probing anyway (context.request carries all session state).\n");
    }
  } catch (err: any) {
    console.warn(`  Warning during session setup: ${err.message}. Will try probing anyway.\n`);
  } finally {
    await page.close();
  }

  // 5. Process URLs with concurrency — using context.request for all probes
  const limit = pLimit(concurrency);
  let completed = 0;
  let found = 0;
  let notFound = 0;
  let errors = 0;
  const startTime = Date.now();

  const tasks = pending.map((originalUrl) =>
    limit(async () => {
      const baseId = extractBaseId(originalUrl);
      const baseUrl = originalUrl.replace(/\.[^.]+$/, "");

      try {
        const result = await resolveUrl(context, baseUrl);

        const row: CsvRow = {
          base_id: baseId,
          original_url: originalUrl,
          base_url: baseUrl,
          ...result,
        };

        appendRow(outputPath, row);
        completed++;

        if (result.status === "resolved") {
          found++;
          console.log(
            `  [${completed}/${pending.length}] ${baseId} -> .${result.extension} (${result.file_type}) ${result.content_length > 0 ? `${(result.content_length / 1024).toFixed(0)}KB` : ""}`,
          );
        } else {
          notFound++;
          if (completed % 25 === 0) {
            console.log(
              `  [${completed}/${pending.length}] Progress: ${found} found, ${notFound} not found, ${errors} errors`,
            );
          }
        }

        // Periodic summary
        if (completed % 100 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = completed / elapsed;
          const eta = ((pending.length - completed) / rate / 60).toFixed(1);
          console.log(
            `\n  === ${completed}/${pending.length} (${found} found) | ${rate.toFixed(1)} URLs/sec | ETA: ${eta}m ===\n`,
          );
        }
      } catch (err: any) {
        errors++;
        const row: CsvRow = {
          base_id: baseId,
          original_url: originalUrl,
          base_url: baseUrl,
          status: "error",
          resolved_url: "",
          extension: "",
          file_type: "",
          content_type: "",
          content_length: 0,
          notes: err.message || "unknown_error",
        };
        appendRow(outputPath, row);
        completed++;
      }
    }),
  );

  await Promise.all(tasks);

  // 6. Close browser and summarize
  try { await closeBrowser(); } catch {}

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== Resolution Summary ===");
  console.log(`Total processed: ${completed}`);
  console.log(`Resolved:        ${found}`);
  console.log(`Not found:       ${notFound}`);
  console.log(`Errors:          ${errors}`);
  console.log(`Time:            ${elapsed}s`);
  console.log(`Output:          ${outputPath}`);
}

// ===== DOWNLOAD MODE =====

interface DownloadProgress {
  completed: Record<string, { hash: string; localPath: string; bytes: number }>;
  failed: string[];
  totalBytes: number;
  startedAt: string;
  lastUpdated: string;
}

function loadDownloadProgress(): DownloadProgress {
  if (fs.existsSync(RESOLVED_PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(RESOLVED_PROGRESS_FILE, "utf-8"));
  }
  return {
    completed: {},
    failed: [],
    totalBytes: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveDownloadProgress(progress: DownloadProgress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(RESOLVED_PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function computeHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

interface ResolvedEntry {
  base_id: string;
  resolved_url: string;
  extension: string;
  file_type: string;
}

function loadResolvedEntries(csvPath: string): ResolvedEntry[] {
  if (!fs.existsSync(csvPath)) return [];

  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const entries: ResolvedEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 7) continue;
    const status = parts[3];
    if (status !== "resolved") continue;

    entries.push({
      base_id: parts[0],
      resolved_url: parts[4],
      extension: parts[5],
      file_type: parts[6],
    });
  }

  return entries;
}

async function downloadResolvedFile(
  context: BrowserContext,
  entry: ResolvedEntry,
  progress: DownloadProgress,
): Promise<{ success: boolean; bytes: number }> {
  const filename = `${entry.base_id}.${entry.extension}`;
  fs.mkdirSync(RESOLVED_DOWNLOADS_DIR, { recursive: true });
  const outputPath = path.join(RESOLVED_DOWNLOADS_DIR, filename);

  // Resume: skip if already downloaded with valid hash
  if (fs.existsSync(outputPath) && progress.completed[entry.resolved_url]) {
    const existingHash = await computeHash(outputPath);
    if (existingHash === progress.completed[entry.resolved_url].hash) {
      return { success: true, bytes: progress.completed[entry.resolved_url].bytes };
    }
    fs.unlinkSync(outputPath);
  }

  if (progress.completed[entry.resolved_url] && !fs.existsSync(outputPath)) {
    delete progress.completed[entry.resolved_url];
  }

  // Extract cookies from browser context for Node fetch() streaming downloads
  const cookies = await context.cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    try {
      await throttle();

      const headers: Record<string, string> = {
        ...PROBE_HEADERS,
        Accept: "application/octet-stream,*/*",
        "Accept-Encoding": "gzip, deflate, br",
        Cookie: cookieHeader,
      };

      const response = await fetch(entry.resolved_url, {
        headers,
        redirect: "follow",
      });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("retry-after") || "5", 10);
        console.warn(`  429 rate-limited on ${filename}, waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        console.warn(`  HTTP ${response.status} for ${filename} (attempt ${attempt}/${DOWNLOAD_RETRIES}) — refreshing session`);
        await refreshSession(context);
        if (attempt < DOWNLOAD_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return { success: false, bytes: 0 };
      }

      if (!response.ok) {
        console.warn(`  HTTP ${response.status} for ${filename} (attempt ${attempt}/${DOWNLOAD_RETRIES})`);
        if (attempt === DOWNLOAD_RETRIES) return { success: false, bytes: 0 };
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);

      if (contentLength > STREAM_THRESHOLD && response.body) {
        const nodeStream = Readable.fromWeb(response.body as any);
        const writeStream = fs.createWriteStream(outputPath);
        await pipeline(nodeStream, writeStream);
      } else {
        const arrayBuf = await response.arrayBuffer();
        fs.writeFileSync(outputPath, Buffer.from(arrayBuf));
      }

      const stat = fs.statSync(outputPath);
      const fileHash = await computeHash(outputPath);

      progress.completed[entry.resolved_url] = {
        hash: fileHash,
        localPath: outputPath,
        bytes: stat.size,
      };
      progress.totalBytes += stat.size;

      console.log(`  Downloaded: ${filename} (${formatBytes(stat.size)}, sha256:${fileHash.substring(0, 12)}...)`);
      return { success: true, bytes: stat.size };
    } catch (err: any) {
      console.warn(`  Error downloading ${filename} (attempt ${attempt}/${DOWNLOAD_RETRIES}): ${err.message}`);
      if (attempt === DOWNLOAD_RETRIES) return { success: false, bytes: 0 };
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  return { success: false, bytes: 0 };
}

async function downloadResolvedFiles(resolvedCsvPath: string): Promise<void> {
  console.log("\n=== DOJ Download Resolved Files ===\n");

  // 1. Load resolved entries from CSV
  const entries = loadResolvedEntries(resolvedCsvPath);
  console.log(`Found ${entries.length} resolved entries in ${resolvedCsvPath}`);

  if (entries.length === 0) {
    console.log("No resolved entries to download. Run resolution first.");
    return;
  }

  // 2. Load download progress
  const progress = loadDownloadProgress();
  const pending = entries.filter((e) => !progress.completed[e.resolved_url]);
  console.log(`Already downloaded: ${entries.length - pending.length}`);
  console.log(`Remaining: ${pending.length}\n`);

  if (pending.length === 0) {
    console.log("All resolved files already downloaded.");
    return;
  }

  // 3. Open browser and establish Akamai session
  console.log("Opening browser and establishing Akamai session...");
  const context = await getBrowserContext();

  const page = await context.newPage();
  try {
    await page.goto("https://www.justice.gov/epstein/files/DataSet%201/EFTA00003159.pdf", {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    let cookies = await context.cookies();
    let hasAuth = cookies.some(c => c.name.startsWith("authorization_"));

    if (!hasAuth) {
      const USE_HEADED = process.env.DOJ_HEADED === "1" || process.argv.includes("--headed");
      if (USE_HEADED) {
        console.log("  Akamai cookies not found after auto-solve.");
        console.log("  >>> Please solve the bot challenge in the browser window <<<");
        console.log("  Waiting up to 120s for authorization cookies...");
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          await page.waitForTimeout(3000);
          cookies = await context.cookies();
          hasAuth = cookies.some(c => c.name.startsWith("authorization_"));
          if (hasAuth) {
            console.log("  Akamai cookies obtained!\n");
            break;
          }
        }
      }
    }

    if (hasAuth) {
      console.log("  Akamai session established.\n");
    } else {
      console.log("  No authorization cookies found — will try downloading anyway.\n");
    }
  } catch (err: any) {
    console.warn(`  Warning during session setup: ${err.message}. Will try downloading anyway.\n`);
  } finally {
    await page.close();
  }

  // 4. Download with concurrency
  const limit = pLimit(DOWNLOAD_CONCURRENCY);
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  let totalBytes = 0;
  const startTime = Date.now();

  const tasks = pending.map((entry) =>
    limit(async () => {
      const result = await downloadResolvedFile(context, entry, progress);
      completed++;

      if (result.success) {
        succeeded++;
        totalBytes += result.bytes;
      } else {
        failed++;
        if (!progress.failed.includes(entry.resolved_url)) {
          progress.failed.push(entry.resolved_url);
        }
      }

      // Save progress every 10 downloads
      if (completed % 10 === 0) {
        saveDownloadProgress(progress);
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = completed / elapsed;
        const eta = ((pending.length - completed) / rate / 60).toFixed(1);
        console.log(
          `\n  === ${completed}/${pending.length} (${succeeded} ok, ${failed} failed) | ${formatBytes(totalBytes)} | ETA: ${eta}m ===\n`,
        );
      }
    }),
  );

  await Promise.all(tasks);
  saveDownloadProgress(progress);

  // 5. Close browser and summarize
  try { await closeBrowser(); } catch {}

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== Download Summary ===");
  console.log(`Total processed: ${completed}`);
  console.log(`Succeeded:       ${succeeded}`);
  console.log(`Failed:          ${failed}`);
  console.log(`Total size:      ${formatBytes(totalBytes)}`);
  console.log(`Time:            ${elapsed}s`);
  console.log(`Output:          ${RESOLVED_DOWNLOADS_DIR}`);
}

// ===== CLI =====

function parseArgs(): {
  inputCsv: string;
  outputCsv: string;
  concurrency: number;
  download: boolean;
  downloadOnly: boolean;
} {
  const args = process.argv.slice(2);
  let inputCsv = "";
  let outputCsv = DEFAULT_OUTPUT;
  let concurrency = DEFAULT_CONCURRENCY;
  let download = false;
  let downloadOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputCsv = args[++i];
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = parseInt(args[++i], 10);
    } else if (args[i] === "--headed") {
      // Handled by doj-scraper via process.argv
    } else if (args[i] === "--download") {
      download = true;
    } else if (args[i] === "--download-only") {
      downloadOnly = true;
    } else if (!args[i].startsWith("--") && !inputCsv) {
      inputCsv = args[i];
    }
  }

  if (!inputCsv) {
    console.error(
      "Usage: npx tsx scripts/pipeline/extension-resolver.ts <input.csv> [options]\n\n" +
      "Options:\n" +
      "  --output PATH       Output CSV path (default: data/resolved.partial.csv)\n" +
      "  --concurrency N     Max parallel URL resolutions (default: 2)\n" +
      "  --download          Resolve extensions, then download resolved files\n" +
      "  --download-only     Skip resolution, download from existing CSV\n" +
      "  --headed            Show browser window for manual bot challenge solving"
    );
    process.exit(1);
  }

  // Resolve relative paths
  if (!path.isAbsolute(inputCsv)) {
    inputCsv = path.resolve(process.cwd(), inputCsv);
  }
  if (!path.isAbsolute(outputCsv)) {
    outputCsv = path.resolve(process.cwd(), outputCsv);
  }

  if (!fs.existsSync(inputCsv)) {
    console.error(`Input file not found: ${inputCsv}`);
    process.exit(1);
  }

  return { inputCsv, outputCsv, concurrency, download, downloadOnly };
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const { inputCsv, outputCsv, concurrency, download, downloadOnly } = parseArgs();

  (async () => {
    // Step 1: Resolve extensions (unless --download-only)
    if (!downloadOnly) {
      await resolveExtensions(inputCsv, outputCsv, concurrency);
    }

    // Step 2: Download resolved files (if --download or --download-only)
    if (download || downloadOnly) {
      await downloadResolvedFiles(outputCsv);
    }
  })()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
