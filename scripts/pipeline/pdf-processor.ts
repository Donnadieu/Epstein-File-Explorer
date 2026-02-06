import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

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
  method: "pdf-parse" | "ocr" | "image-metadata";
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
  const pdfParse = (await import("pdf-parse")).default;

  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);

  return {
    text: result.text || "",
    pageCount: result.numpages || 0,
    metadata: {
      title: result.info?.Title || "",
      author: result.info?.Author || "",
      creator: result.info?.Creator || "",
      producer: result.info?.Producer || "",
      creationDate: result.info?.CreationDate || "",
      modDate: result.info?.ModDate || "",
    },
  };
}

function extractImageMetadata(filePath: string): { text: string; metadata: Record<string, any> } {
  const stats = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  return {
    text: "",
    metadata: {
      fileType: ext.replace(".", ""),
      fileSize: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      requiresOCR: true,
    },
  };
}

async function processFile(filePath: string, dataSetId: number, log: ExtractionLog): Promise<ExtractedDocument | null> {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (log.processed.includes(filePath)) {
    return null;
  }

  try {
    const stats = fs.statSync(filePath);
    let result: ExtractedDocument;

    if (ext === ".pdf") {
      console.log(`  Processing PDF: ${fileName}`);
      const extracted = await extractPdfText(filePath);

      result = {
        filePath,
        fileName,
        dataSetId,
        text: extracted.text,
        pageCount: extracted.pageCount,
        metadata: extracted.metadata,
        extractedAt: new Date().toISOString(),
        method: "pdf-parse",
        fileType: "pdf",
        fileSizeBytes: stats.size,
      };

      log.totalPages += extracted.pageCount;
      log.totalChars += extracted.text.length;
    } else if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff"].includes(ext)) {
      console.log(`  Cataloging image: ${fileName}`);
      const imgData = extractImageMetadata(filePath);

      result = {
        filePath,
        fileName,
        dataSetId,
        text: imgData.text,
        pageCount: 0,
        metadata: imgData.metadata,
        extractedAt: new Date().toISOString(),
        method: "image-metadata",
        fileType: ext.replace(".", ""),
        fileSizeBytes: stats.size,
      };
    } else if ([".mp4", ".avi", ".mov", ".wmv", ".mkv"].includes(ext)) {
      console.log(`  Cataloging video: ${fileName}`);

      result = {
        filePath,
        fileName,
        dataSetId,
        text: "",
        pageCount: 0,
        metadata: {
          fileType: ext.replace(".", ""),
          fileSize: stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          requiresVideoAnalysis: true,
        },
        extractedAt: new Date().toISOString(),
        method: "image-metadata",
        fileType: ext.replace(".", ""),
        fileSizeBytes: stats.size,
      };
    } else {
      console.log(`  Reading text file: ${fileName}`);
      const text = fs.readFileSync(filePath, "utf-8");

      result = {
        filePath,
        fileName,
        dataSetId,
        text,
        pageCount: 1,
        metadata: {},
        extractedAt: new Date().toISOString(),
        method: "pdf-parse",
        fileType: ext.replace(".", ""),
        fileSizeBytes: stats.size,
      };

      log.totalChars += text.length;
    }

    log.processed.push(filePath);
    saveLog(log);

    return result;
  } catch (error: any) {
    console.warn(`  Error processing ${fileName}: ${error.message}`);
    log.failed.push(filePath);
    saveLog(log);
    return null;
  }
}

function findFiles(dir: string, extensions?: string[]): Array<{ path: string; dataSetId: number }> {
  const results: Array<{ path: string; dataSetId: number }> = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const dataSetMatch = entry.name.match(/data-set-(\d+)/);
      const dataSetId = dataSetMatch ? parseInt(dataSetMatch[1], 10) : 0;

      const subFiles = findFilesInDir(fullPath, dataSetId, extensions);
      results.push(...subFiles);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions || extensions.includes(ext)) {
        results.push({ path: fullPath, dataSetId: 0 });
      }
    }
  }

  return results;
}

function findFilesInDir(dir: string, dataSetId: number, extensions?: string[]): Array<{ path: string; dataSetId: number }> {
  const results: Array<{ path: string; dataSetId: number }> = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesInDir(fullPath, dataSetId, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions || extensions.includes(ext)) {
        results.push({ path: fullPath, dataSetId });
      }
    }
  }

  return results;
}

export async function processDocuments(options: {
  inputDir?: string;
  dataSetIds?: number[];
  fileTypes?: string[];
  maxFiles?: number;
  outputDir?: string;
}): Promise<ExtractedDocument[]> {
  console.log("\n=== Document Processor ===\n");

  const {
    inputDir = DOWNLOADS_DIR,
    fileTypes = [".pdf"],
    maxFiles = Infinity,
    outputDir = EXTRACTED_DIR,
  } = options;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const allFiles = findFiles(inputDir, fileTypes);
  const filesToProcess = allFiles.slice(0, maxFiles);

  console.log(`Found ${allFiles.length} files, processing ${filesToProcess.length}`);

  const log = loadLog();
  const results: ExtractedDocument[] = [];
  let processed = 0;

  for (const file of filesToProcess) {
    const result = await processFile(file.path, file.dataSetId, log);
    if (result) {
      results.push(result);

      const outputFile = path.join(
        outputDir,
        `ds${result.dataSetId}`,
        `${path.basename(result.fileName, path.extname(result.fileName))}.json`
      );
      const outputSubDir = path.dirname(outputFile);
      if (!fs.existsSync(outputSubDir)) fs.mkdirSync(outputSubDir, { recursive: true });

      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
    }

    processed++;
    if (processed % 50 === 0) {
      console.log(`\nProgress: ${processed}/${filesToProcess.length} files processed`);
      console.log(`Total pages extracted: ${log.totalPages}`);
      console.log(`Total characters: ${log.totalChars.toLocaleString()}\n`);
    }
  }

  console.log("\n=== Processing Summary ===");
  console.log(`Files processed: ${results.length}`);
  console.log(`Files failed: ${log.failed.length}`);
  console.log(`Total pages: ${log.totalPages}`);
  console.log(`Total text chars: ${log.totalChars.toLocaleString()}`);
  console.log(`Output directory: ${outputDir}`);

  return results;
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof processDocuments>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      options.inputDir = args[++i];
    } else if (args[i] === "--types" && args[i + 1]) {
      options.fileTypes = args[++i].split(",").map(t => t.startsWith(".") ? t : `.${t}`);
    } else if (args[i] === "--max" && args[i + 1]) {
      options.maxFiles = parseInt(args[++i], 10);
    } else if (args[i] === "--output" && args[i + 1]) {
      options.outputDir = args[++i];
    }
  }

  processDocuments(options).catch(console.error);
}
