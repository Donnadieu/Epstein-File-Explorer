import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const EXTRACTION_LOG = path.join(DATA_DIR, "extraction-log.json");

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
  processed: string[];
  failed: string[];
  totalPages: number;
  totalChars: number;
  startedAt: string;
  lastUpdated: string;
}

function loadLog(): ExtractionLog {
  if (fs.existsSync(EXTRACTION_LOG)) {
    return JSON.parse(fs.readFileSync(EXTRACTION_LOG, "utf-8"));
  }
  return {
    processed: [],
    failed: [],
    totalPages: 0,
    totalChars: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveLog(log: ExtractionLog) {
  log.lastUpdated = new Date().toISOString();
  fs.writeFileSync(EXTRACTION_LOG, JSON.stringify(log, null, 2));
}

async function extractPdfText(filePath: string): Promise<{ text: string; pageCount: number; metadata: Record<string, any> }> {
  const buffer = fs.readFileSync(filePath);
  const data = new Uint8Array(buffer);

  try {
    const doc = await pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      disableAutoFetch: true,
      isEvalSupported: false,
    }).promise;

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
  }
}

async function processFile(filePath: string, dataSetId: number, log: ExtractionLog): Promise<ExtractedDocument | null> {
  const fileName = path.basename(filePath);

  if (log.processed.includes(filePath)) {
    return null;
  }

  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext !== ".pdf") {
      return null;
    }

    const extracted = await extractPdfText(filePath);

    const result: ExtractedDocument = {
      filePath,
      fileName,
      dataSetId,
      text: extracted.text,
      pageCount: extracted.pageCount,
      metadata: extracted.metadata,
      extractedAt: new Date().toISOString(),
      method: "pdfjs",
      fileType: "pdf",
      fileSizeBytes: stats.size,
    };

    log.totalPages += extracted.pageCount;
    log.totalChars += extracted.text.length;
    log.processed.push(filePath);

    if (log.processed.length % 20 === 0) {
      saveLog(log);
    }

    return result;
  } catch (error: any) {
    console.warn(`  Error processing ${fileName}: ${error.message}`);
    log.failed.push(filePath);
    saveLog(log);
    return null;
  }
}

export async function processDocuments(options: {
  inputDir?: string;
  dataSetIds?: number[];
  fileTypes?: string[];
  maxFiles?: number;
  outputDir?: string;
}): Promise<ExtractedDocument[]> {
  console.log("\n=== PDF Text Extractor ===\n");

  const {
    inputDir = DOWNLOADS_DIR,
    maxFiles = Infinity,
    outputDir = EXTRACTED_DIR,
  } = options;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const allFiles: Array<{ path: string; dataSetId: number }> = [];

  if (fs.existsSync(inputDir)) {
    const dirs = fs.readdirSync(inputDir)
      .filter(d => d.startsWith("data-set-") && fs.statSync(path.join(inputDir, d)).isDirectory())
      .sort();

    for (const dir of dirs) {
      const dsMatch = dir.match(/data-set-(\d+)/);
      if (!dsMatch) continue;
      const dsId = parseInt(dsMatch[1], 10);

      if (options.dataSetIds && !options.dataSetIds.includes(dsId)) continue;

      const dsPath = path.join(inputDir, dir);
      const files = fs.readdirSync(dsPath)
        .filter(f => f.toLowerCase().endsWith(".pdf"))
        .map(f => ({ path: path.join(dsPath, f), dataSetId: dsId }));

      allFiles.push(...files);
    }
  }

  const filesToProcess = allFiles.slice(0, maxFiles);
  console.log(`Found ${allFiles.length} PDFs, processing ${filesToProcess.length}`);

  const log = loadLog();
  const results: ExtractedDocument[] = [];
  let processed = 0;
  let skipped = 0;

  for (const file of filesToProcess) {
    const result = await processFile(file.path, file.dataSetId, log);
    if (result) {
      results.push(result);

      const outputFile = path.join(
        outputDir,
        `ds${result.dataSetId}`,
        `${path.basename(result.fileName, ".pdf")}.json`
      );
      const outputSubDir = path.dirname(outputFile);
      if (!fs.existsSync(outputSubDir)) fs.mkdirSync(outputSubDir, { recursive: true });
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
      processed++;
    } else {
      skipped++;
    }

    if ((processed + skipped) % 25 === 0) {
      console.log(`  Progress: ${processed} extracted, ${skipped} skipped, ${log.totalPages} total pages, ${log.totalChars.toLocaleString()} chars`);
    }
  }

  saveLog(log);

  console.log("\n=== Extraction Summary ===");
  console.log(`Files extracted: ${processed}`);
  console.log(`Files skipped: ${skipped}`);
  console.log(`Files failed: ${log.failed.length}`);
  console.log(`Total pages: ${log.totalPages}`);
  console.log(`Total text chars: ${log.totalChars.toLocaleString()}`);

  return results;
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
    }
  }

  processDocuments(options).catch(console.error);
}
