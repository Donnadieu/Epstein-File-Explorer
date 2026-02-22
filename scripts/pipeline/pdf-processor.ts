import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "module";
import { createCanvas } from "canvas";

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

// OCR fallback configuration
const OCR_DPI = 200;
const OCR_SCALE = OCR_DPI / 72; // PDF default is 72 DPI
const CHARS_PER_PAGE_THRESHOLD = 50;
const SINGLE_PAGE_CHARS_THRESHOLD = 20;

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
      startedAt: raw.startedAt || new Date().toISOString(),
      lastUpdated: raw.lastUpdated || new Date().toISOString(),
    };
  }
  return {
    totalPages: 0,
    totalChars: 0,
    totalProcessed: 0,
    totalFailed: 0,
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

function isTextQualityPoor(text: string, pageCount: number): boolean {
  const totalChars = text.trim().length;
  if (pageCount <= 1) return totalChars < SINGLE_PAGE_CHARS_THRESHOLD;
  return (totalChars / pageCount) < CHARS_PER_PAGE_THRESHOLD;
}

// Lazy Tesseract worker — created on first use, reused across documents
let tesseractWorker: any = null;

async function getTesseractWorker(): Promise<any> {
  if (!tesseractWorker) {
    console.log("    Initializing Tesseract OCR worker...");
    const Tesseract = await import("tesseract.js");
    tesseractWorker = await Tesseract.createWorker("eng");
    console.log("    Tesseract worker ready.");
  }
  return tesseractWorker;
}

async function terminateTesseractWorker(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

async function extractPdfText(filePath: string): Promise<{ text: string; pageCount: number; metadata: Record<string, any> }> {
  const buffer = fs.readFileSync(filePath);
  const data = new Uint8Array(buffer);

  let doc: any = null;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      disableAutoFetch: true,
      isEvalSupported: false,
    });
    // Catch internal pdf.js rejections that bypass the main promise
    loadingTask.onUnsupportedFeature = () => {};
    doc = await loadingTask.promise;

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

async function extractPdfTextWithOCR(filePath: string): Promise<{ text: string; pageCount: number; metadata: Record<string, any> }> {
  const buffer = fs.readFileSync(filePath);
  const data = new Uint8Array(buffer);

  let doc: any = null;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      disableAutoFetch: true,
      isEvalSupported: false,
    });
    loadingTask.onUnsupportedFeature = () => {};
    doc = await loadingTask.promise;

    const pageCount = doc.numPages;
    const worker = await getTesseractWorker();
    let fullText = "";

    for (let i = 1; i <= pageCount; i++) {
      let page: any = null;
      try {
        page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: OCR_SCALE });
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        await page.render({ canvasContext: ctx as any, viewport }).promise;

        const pngBuffer = canvas.toBuffer("image/png");
        const { data: ocrResult } = await worker.recognize(pngBuffer);
        const pageText = ocrResult.text.trim();

        if (pageText.length > 0) {
          fullText += pageText + "\n\n";
        }

        page.cleanup();
        page = null;
      } catch (pageError: any) {
        console.warn(`    OCR page ${i} error: ${pageError.message?.substring(0, 100)}`);
        if (page) page.cleanup();
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
    metadata.ocrDpi = OCR_DPI;

    return { text: fullText.trim(), pageCount, metadata };
  } catch (error: any) {
    console.warn(`    OCR extraction error: ${error.message?.substring(0, 100)}`);
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
  reprocessEmpty?: boolean;
}): Promise<ExtractedDocument[]> {
  console.log("\n=== PDF Text Extractor ===\n");

  const {
    inputDir = DOWNLOADS_DIR,
    maxFiles = Infinity,
    outputDir = EXTRACTED_DIR,
  } = options;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Collect files to process per data set
  const dirs = fs.existsSync(inputDir)
    ? fs.readdirSync(inputDir)
        .filter(d => d.startsWith("data-set-") && fs.statSync(path.join(inputDir, d)).isDirectory())
        .sort()
    : [];

  const log = loadLog();

  // Pre-pass: remove low-quality extractions so they get re-extracted with OCR
  if (options.reprocessEmpty) {
    console.log("  Scanning for low-quality extractions to reprocess...");
    let removedCount = 0;

    for (const dir of dirs) {
      const dsMatch = dir.match(/data-set-(\d+)/);
      if (!dsMatch) continue;
      const dsId = parseInt(dsMatch[1], 10);
      if (options.dataSetIds && !options.dataSetIds.includes(dsId)) continue;

      const dsOutputDir = path.join(outputDir, `ds${dsId}`);
      if (!fs.existsSync(dsOutputDir)) continue;

      const jsonFiles = fs.readdirSync(dsOutputDir).filter(f => f.endsWith(".json"));
      for (const jsonFile of jsonFiles) {
        const jsonPath = path.join(dsOutputDir, jsonFile);
        try {
          const doc: ExtractedDocument = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
          if (doc.method === "ocr") continue; // Already OCR'd, skip
          if (isTextQualityPoor(doc.text, doc.pageCount)) {
            log.totalPages -= doc.pageCount;
            log.totalChars -= doc.text.length;
            log.totalProcessed--;
            fs.unlinkSync(jsonPath);
            removedCount++;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    console.log(`  Removed ${removedCount} low-quality extractions for reprocessing`);
  }
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let ocrCount = 0;
  let totalFiles = 0;

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

    for (const fileName of pdfFiles) {
      if (processed + skipped >= maxFiles) break;

      // Skip if already extracted (check output file exists on disk)
      const outPath = getOutputPath(outputDir, dsId, fileName);
      if (fs.existsSync(outPath)) {
        skipped++;
        continue;
      }

      const filePath = path.join(dsPath, fileName);

      try {
        const stats = fs.statSync(filePath);
        const extracted = await extractPdfText(filePath);

        let method: ExtractedDocument["method"] = "pdfjs";
        let finalExtracted = extracted;

        // OCR fallback when pdf.js yields poor text
        if (isTextQualityPoor(extracted.text, extracted.pageCount) && extracted.pageCount > 0) {
          console.log(`    Low text quality for ${fileName} (${extracted.text.length} chars, ${extracted.pageCount} pages) - trying OCR...`);
          const ocrResult = await extractPdfTextWithOCR(filePath);
          if (ocrResult.text.length > extracted.text.length) {
            finalExtracted = ocrResult;
            method = "ocr";
            ocrCount++;
            console.log(`    OCR improved: ${extracted.text.length} → ${ocrResult.text.length} chars`);
          } else {
            console.log(`    OCR did not improve results (${ocrResult.text.length} chars), keeping pdfjs output`);
          }
        }

        const result: ExtractedDocument = {
          filePath,
          fileName,
          dataSetId: dsId,
          text: finalExtracted.text,
          pageCount: finalExtracted.pageCount,
          metadata: finalExtracted.metadata,
          extractedAt: new Date().toISOString(),
          method,
          fileType: "pdf",
          fileSizeBytes: stats.size,
        };

        // Write to disk immediately, don't accumulate in memory
        if (!fs.existsSync(dsOutputDir)) fs.mkdirSync(dsOutputDir, { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

        log.totalPages += finalExtracted.pageCount;
        log.totalChars += finalExtracted.text.length;
        log.totalProcessed++;
        processed++;
      } catch (error: any) {
        console.warn(`  Error processing ${fileName}: ${error.message}`);
        log.totalFailed++;
        failed++;
      }

      if ((processed + failed) % 100 === 0) {
        saveLog(log);
        console.log(`  Progress: ${processed} extracted, ${skipped} skipped, ${failed} failed, ${log.totalPages} pages, ${log.totalChars.toLocaleString()} chars`);
      }
    }
  }

  await terminateTesseractWorker();
  saveLog(log);

  console.log("\n=== Extraction Summary ===");
  console.log(`Total PDFs found: ${totalFiles}`);
  console.log(`Extracted: ${processed} (${ocrCount} via OCR)`);
  console.log(`Skipped (already done): ${skipped}`);
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
    } else if (args[i] === "--reprocess-empty") {
      options.reprocessEmpty = true;
    }
  }

  processDocuments(options).catch(console.error);
}
