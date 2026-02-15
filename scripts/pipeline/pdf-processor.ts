import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "module";
import pLimit from "p-limit";

// Prevent corrupted PDFs from crashing the process with unhandled rejections
process.on("unhandledRejection", (reason: any) => {
  console.warn(`    Suppressed pdf.js rejection: ${String(reason).substring(0, 100)}`);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const STANDARD_FONT_DATA_URL = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

const DATA_DIR = path.resolve(__dirname, "../../data");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const EXTRACTION_LOG = path.join(DATA_DIR, "extraction-log.json");

const DEFAULT_MAX_FILE_SIZE_MB = 256;
const DEFAULT_MAX_CONCURRENT_PDFS = 4;

export interface ExtractedDocument {
  filePath: string;
  fileName: string;
  dataSetId: number;
  text: string;
  pageCount: number;
  metadata: Record<string, any>;
  extractedAt: string;
  method: "pdfjs" | "ocr" | "image-metadata";
  fileType: string;
  fileSizeBytes: number;
}

interface ExtractionLog {
  totalPages: number;
  totalChars: number;
  totalProcessed: number;
  totalFailed: number;
  totalSkippedOversize: number;
  startedAt: string;
  lastUpdated: string;
}

function loadLog(): ExtractionLog {
  if (fs.existsSync(EXTRACTION_LOG)) {
    const raw = JSON.parse(fs.readFileSync(EXTRACTION_LOG, "utf-8"));
    // Migrate from old format that stored full arrays
    return {
      totalPages: raw.totalPages || 0,
      totalChars: raw.totalChars || 0,
      totalProcessed: raw.totalProcessed ?? (raw.processed?.length || 0),
      totalFailed: raw.totalFailed ?? (raw.failed?.length || 0),
      totalSkippedOversize: raw.totalSkippedOversize || 0,
      startedAt: raw.startedAt || new Date().toISOString(),
      lastUpdated: raw.lastUpdated || new Date().toISOString(),
    };
  }
  return {
    totalPages: 0,
    totalChars: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalSkippedOversize: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveLog(log: ExtractionLog) {
  log.lastUpdated = new Date().toISOString();
  fs.writeFileSync(EXTRACTION_LOG, JSON.stringify(log, null, 2));
}

function getOutputPath(outputDir: string, dataSetId: number, fileName: string): string {
  return path.join(outputDir, `ds${dataSetId}`, `${path.basename(fileName, ".pdf")}.json`);
}

/** Read file in chunks via stream to avoid blocking; returns full buffer (PDF.js needs it). */
function readFileStreamed(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function extractPdfText(filePath: string): Promise<{ text: string; pageCount: number; metadata: Record<string, any> }> {
  // Prefer file URL so PDF.js handles I/O (avoids loading entire file into our process memory).
  // Fallback: stream file into buffer then pass as data (non-blocking read, still full buffer in memory).
  const fileUrl = pathToFileURL(path.resolve(filePath)).href;
  const docOptions = {
    useSystemFonts: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    disableAutoFetch: true,
    isEvalSupported: false,
  } as const;

  let doc: any = null;
  try {
    let loadingTask = pdfjsLib.getDocument({ url: fileUrl, ...docOptions });
    loadingTask.onUnsupportedFeature = () => {};
    try {
      doc = await loadingTask.promise;
    } catch (urlErr: any) {
      if (urlErr?.message?.includes("fetch") || urlErr?.message?.includes("url") || urlErr?.code === "ERR_UNSUPPORTED_ESM_URL") {
        const buffer = await readFileStreamed(filePath);
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), ...docOptions });
        loadingTask.onUnsupportedFeature = () => {};
        doc = await loadingTask.promise;
      } else {
        throw urlErr;
      }
    }

    let fullText = "";
    const pageCount = doc.numPages;

    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (pageText.length > 0) {
          fullText += pageText + "\n\n";
        }
        page.cleanup();
      } catch {
      }
    }

    let metadata: Record<string, any> = {};
    try {
      const meta = await doc.getMetadata();
      metadata = {
        title: (meta?.info as any)?.Title || "",
        author: (meta?.info as any)?.Author || "",
        creator: (meta?.info as any)?.Creator || "",
        producer: (meta?.info as any)?.Producer || "",
      };
    } catch {
    }

    return { text: fullText.trim(), pageCount, metadata };
  } catch (error: any) {
    console.warn(`    PDF parse error: ${error.message?.substring(0, 100)}`);
    return { text: "", pageCount: 0, metadata: { error: error.message } };
  } finally {
    if (doc) doc.destroy();
  }
}

export async function processDocuments(options: {
  inputDir?: string;
  dataSetIds?: number[];
  fileTypes?: string[];
  maxFiles?: number;
  outputDir?: string;
  maxFileSizeMB?: number;
  maxConcurrentPdfs?: number;
  skipOversize?: boolean;
}): Promise<ExtractedDocument[]> {
  console.log("\n=== PDF Text Extractor ===\n");

  const {
    inputDir = DOWNLOADS_DIR,
    maxFiles = Infinity,
    outputDir = EXTRACTED_DIR,
    maxFileSizeMB = DEFAULT_MAX_FILE_SIZE_MB,
    maxConcurrentPdfs = DEFAULT_MAX_CONCURRENT_PDFS,
    skipOversize = true,
  } = options;

  const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

  console.log(`  Max file size: ${maxFileSizeMB} MB`);
  console.log(`  Max concurrent PDFs: ${maxConcurrentPdfs}`);
  console.log(`  Skip oversize: ${skipOversize}`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Collect files to process per data set
  const dirs = fs.existsSync(inputDir)
    ? fs.readdirSync(inputDir)
        .filter(d => d.startsWith("data-set-") && fs.statSync(path.join(inputDir, d)).isDirectory())
        .sort()
    : [];

  const log = loadLog();
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let skippedOversize = 0;
  let totalFiles = 0;

  const limit = pLimit(maxConcurrentPdfs);

  for (const dir of dirs) {
    const dsMatch = dir.match(/data-set-(\d+)/);
    if (!dsMatch) continue;
    const dsId = parseInt(dsMatch[1], 10);

    if (options.dataSetIds && !options.dataSetIds.includes(dsId)) continue;

    const dsPath = path.join(inputDir, dir);
    const dsOutputDir = path.join(outputDir, `ds${dsId}`);
    const pdfFiles = fs.readdirSync(dsPath).filter(f => f.toLowerCase().endsWith(".pdf"));
    totalFiles += pdfFiles.length;

    console.log(`  DS ${dsId}: ${pdfFiles.length} PDFs`);

    // Build batch of work items then execute with concurrency limit
    const batch: (() => Promise<void>)[] = [];

    for (const fileName of pdfFiles) {
      if (processed + skipped + skippedOversize >= maxFiles) break;
      // Cap batch so we don't queue more than maxFiles total
      if (processed + skipped + skippedOversize + batch.length >= maxFiles) break;

      // Skip if already extracted (check output file exists on disk)
      const outPath = getOutputPath(outputDir, dsId, fileName);
      if (fs.existsSync(outPath)) {
        skipped++;
        continue;
      }

      const filePath = path.join(dsPath, fileName);

      batch.push(async () => {
        try {
          const stats = fs.statSync(filePath);

          // --- Resource guardrail: skip oversize files ---
          if (stats.size > maxFileSizeBytes) {
            if (skipOversize) {
              skippedOversize++;
              log.totalSkippedOversize++;
              console.warn(`    Skipped oversize: ${fileName} (${(stats.size / (1024 * 1024)).toFixed(1)} MB > ${maxFileSizeMB} MB)`);
              return;
            } else {
              console.warn(`    Warning: large file ${fileName} (${(stats.size / (1024 * 1024)).toFixed(1)} MB) — processing anyway`);
            }
          }

          const extracted = await extractPdfText(filePath);

          const result: ExtractedDocument = {
            filePath,
            fileName,
            dataSetId: dsId,
            text: extracted.text,
            pageCount: extracted.pageCount,
            metadata: extracted.metadata,
            extractedAt: new Date().toISOString(),
            method: "pdfjs",
            fileType: "pdf",
            fileSizeBytes: stats.size,
          };

          // Write to disk immediately, don't accumulate in memory
          if (!fs.existsSync(dsOutputDir)) fs.mkdirSync(dsOutputDir, { recursive: true });
          fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

          log.totalPages += extracted.pageCount;
          log.totalChars += extracted.text.length;
          log.totalProcessed++;
          processed++;
        } catch (error: any) {
          console.warn(`  Error processing ${fileName}: ${error.message}`);
          log.totalFailed++;
          failed++;
        }

        if ((processed + failed) % 100 === 0 && (processed + failed) > 0) {
          saveLog(log);
          console.log(`  Progress: ${processed} extracted, ${skipped} skipped, ${skippedOversize} oversize, ${failed} failed, ${log.totalPages} pages, ${log.totalChars.toLocaleString()} chars`);
        }
      });
    }

    // Execute batch with concurrency limit
    await Promise.all(batch.map(fn => limit(fn)));
  }

  saveLog(log);

  console.log("\n=== Extraction Summary ===");
  console.log(`Total PDFs found: ${totalFiles}`);
  console.log(`Extracted: ${processed}`);
  console.log(`Skipped (already done): ${skipped}`);
  console.log(`Skipped (oversize > ${maxFileSizeMB} MB): ${skippedOversize}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total pages: ${log.totalPages}`);
  console.log(`Total text chars: ${log.totalChars.toLocaleString()}`);

  // Return empty — results are on disk, not in memory
  return [];
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof processDocuments>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      options.inputDir = args[++i];
    } else if (args[i] === "--data-sets" && args[i + 1]) {
      options.dataSetIds = args[++i].split(",").map(Number);
    } else if (args[i] === "--max" && args[i + 1]) {
      options.maxFiles = parseInt(args[++i], 10);
    } else if (args[i] === "--output" && args[i + 1]) {
      options.outputDir = args[++i];
    } else if (args[i] === "--max-file-size-mb" && args[i + 1]) {
      options.maxFileSizeMB = parseInt(args[++i], 10);
    } else if (args[i] === "--max-concurrent-pdfs" && args[i + 1]) {
      options.maxConcurrentPdfs = parseInt(args[++i], 10);
    } else if (args[i] === "--no-skip-oversize") {
      options.skipOversize = false;
    }
  }

  processDocuments(options).catch(console.error);
}
