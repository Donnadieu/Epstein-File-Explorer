import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { documents } from "../../shared/schema";
import { eq, isNull, sql } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

// --- Media type definitions ---

export type MediaType = "pdf" | "image" | "video" | "email" | "spreadsheet" | "other";

const EXTENSION_TO_MEDIA_TYPE: Record<string, MediaType> = {
  // PDF
  pdf: "pdf",
  // Images
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  bmp: "image",
  tiff: "image",
  tif: "image",
  webp: "image",
  svg: "image",
  // Video
  mp4: "video",
  avi: "video",
  mov: "video",
  wmv: "video",
  mkv: "video",
  flv: "video",
  mpg: "video",
  mpeg: "video",
  // Email
  eml: "email",
  msg: "email",
  mbox: "email",
  pst: "email",
  // Spreadsheet
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  ods: "spreadsheet",
};

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  wmv: "video/x-ms-wmv",
  mkv: "video/x-matroska",
  flv: "video/x-flv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  mbox: "application/mbox",
  pst: "application/vnd.ms-outlook",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

// --- Magic byte signatures for MIME detection ---

interface MagicSignature {
  offset: number;
  bytes: number[];
  mime: string;
  mediaType: MediaType;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  // PDF
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf", mediaType: "pdf" },
  // JPEG
  { offset: 0, bytes: [0xFF, 0xD8, 0xFF], mime: "image/jpeg", mediaType: "image" },
  // PNG
  { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mime: "image/png", mediaType: "image" },
  // GIF87a
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mime: "image/gif", mediaType: "image" },
  // GIF89a
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mime: "image/gif", mediaType: "image" },
  // BMP
  { offset: 0, bytes: [0x42, 0x4D], mime: "image/bmp", mediaType: "image" },
  // TIFF (little-endian)
  { offset: 0, bytes: [0x49, 0x49, 0x2A, 0x00], mime: "image/tiff", mediaType: "image" },
  // TIFF (big-endian)
  { offset: 0, bytes: [0x4D, 0x4D, 0x00, 0x2A], mime: "image/tiff", mediaType: "image" },
  // WebP (RIFF....WEBP)
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp", mediaType: "image" },
  // MP4 / MOV (ftyp)
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], mime: "video/mp4", mediaType: "video" },
  // AVI (RIFF....AVI )
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: "video/x-msvideo", mediaType: "video" },
  // ZIP-based (xlsx, docx, etc.)
  { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04], mime: "application/zip", mediaType: "other" },
  // OLE2 (xls, doc, msg, pst)
  { offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], mime: "application/x-ole-storage", mediaType: "other" },
];

// --- AI priority scoring by data set ---

const DATA_SET_AI_PRIORITY: Record<string, number> = {
  "1": 3,   // FBI investigative files, flight logs, contact books
  "5": 3,   // Grand jury transcripts, SDNY investigation
  "9": 3,   // High-value communications, private emails
  "10": 1,  // Visual/forensic media (images/videos, less text to analyze)
};
const DEFAULT_AI_PRIORITY = 2;

// --- Classification functions ---

export function classifyByExtension(filename: string): { mediaType: MediaType; mimeType: string } {
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  return {
    mediaType: EXTENSION_TO_MEDIA_TYPE[ext] || "other",
    mimeType: EXTENSION_TO_MIME[ext] || "application/octet-stream",
  };
}

export function detectByMagicBytes(filePath: string): { mime: string; mediaType: MediaType } | null {
  if (!fs.existsSync(filePath)) return null;

  const fd = fs.openSync(filePath, "r");
  try {
    // Read enough bytes for the longest signature check
    const headerBuf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, headerBuf, 0, 16, 0);
    if (bytesRead === 0) return null;

    for (const sig of MAGIC_SIGNATURES) {
      if (sig.offset + sig.bytes.length > bytesRead) continue;

      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (headerBuf[sig.offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) return { mime: sig.mime, mediaType: sig.mediaType };
    }

    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Resolves ambiguity between extension-based and magic-byte detection.
 * If magic bytes disagree with extension, magic bytes win.
 */
export function classifyFile(filename: string, localPath?: string | null): {
  mediaType: MediaType;
  mimeType: string;
} {
  const extResult = classifyByExtension(filename);

  if (localPath && fs.existsSync(localPath)) {
    const magicResult = detectByMagicBytes(localPath);
    if (magicResult) {
      // Magic bytes take priority for ambiguous cases
      if (extResult.mediaType === "other" || extResult.mimeType === "application/octet-stream") {
        return { mediaType: magicResult.mediaType, mimeType: magicResult.mime };
      }
      // If extension says one thing but magic bytes say another, trust magic
      if (magicResult.mediaType !== extResult.mediaType) {
        return { mediaType: magicResult.mediaType, mimeType: magicResult.mime };
      }
    }
  }

  return extResult;
}

export function getAIPriority(dataSet: string | null, fileSizeBytes: number | null, mediaType: MediaType): number {
  // Size heuristic: PDFs under 10KB are likely cover pages or blank — priority 0
  if (mediaType === "pdf" && fileSizeBytes !== null && fileSizeBytes < 10 * 1024) {
    return 0;
  }

  // Images/videos don't benefit from text-based AI analysis
  if (mediaType === "image" || mediaType === "video") {
    return 0;
  }

  if (!dataSet) return DEFAULT_AI_PRIORITY;
  return DATA_SET_AI_PRIORITY[dataSet] ?? DEFAULT_AI_PRIORITY;
}

export function deriveAiAnalysisStatus(priority: number, mediaType: MediaType): string {
  if (priority === 0) return "skipped";
  if (mediaType === "image" || mediaType === "video") return "skipped";
  return "pending";
}

// --- Batch classification against DB ---

export interface ClassificationResult {
  total: number;
  classified: number;
  skipped: number;
  byMediaType: Record<string, number>;
}

export async function classifyAllDocuments(options: {
  downloadDir?: string;
  reclassify?: boolean;
} = {}): Promise<ClassificationResult> {
  const { downloadDir, reclassify = false } = options;
  const baseDir = downloadDir || path.join(process.env.HOME || "/home/runner", "Downloads", "epstein-disclosures");

  console.log("\n=== Media Classifier ===\n");

  // Fetch documents that need classification
  const query = reclassify
    ? db.select().from(documents)
    : db.select().from(documents).where(isNull(documents.mediaType));

  const docs = await query;
  console.log(`Documents to classify: ${docs.length}${reclassify ? " (reclassify all)" : " (unclassified only)"}`);

  const result: ClassificationResult = {
    total: docs.length,
    classified: 0,
    skipped: 0,
    byMediaType: {},
  };

  for (const doc of docs) {
    // Derive filename from sourceUrl, localPath, or title
    const filename = deriveFilename(doc);
    if (!filename) {
      result.skipped++;
      continue;
    }

    // Try to find local file for magic byte detection
    const localFilePath = resolveLocalPath(doc, baseDir);

    const { mediaType, mimeType } = classifyFile(filename, localFilePath);
    const priority = getAIPriority(doc.dataSet, doc.fileSizeBytes, mediaType);
    const aiStatus = deriveAiAnalysisStatus(priority, mediaType);

    try {
      await db
        .update(documents)
        .set({
          mediaType,
          mimeType,
          aiAnalysisStatus: aiStatus,
        })
        .where(eq(documents.id, doc.id));

      result.classified++;
      result.byMediaType[mediaType] = (result.byMediaType[mediaType] || 0) + 1;
    } catch (error: any) {
      console.warn(`  Error classifying doc ${doc.id} (${doc.title}): ${error.message}`);
      result.skipped++;
    }
  }

  console.log(`\nClassification complete:`);
  console.log(`  Classified: ${result.classified}`);
  console.log(`  Skipped: ${result.skipped}`);
  console.log(`  By media type:`);
  for (const [type, count] of Object.entries(result.byMediaType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  return result;
}

function deriveFilename(doc: { sourceUrl: string | null; localPath: string | null; title: string }): string | null {
  if (doc.localPath) {
    return path.basename(doc.localPath);
  }
  if (doc.sourceUrl) {
    const urlPath = new URL(doc.sourceUrl).pathname;
    return decodeURIComponent(path.basename(urlPath));
  }
  // Fall back to title if it looks like a filename
  if (doc.title && /\.\w{2,4}$/.test(doc.title)) {
    return doc.title;
  }
  return null;
}

function resolveLocalPath(
  doc: { localPath: string | null; sourceUrl: string | null; dataSet: string | null },
  baseDir: string,
): string | null {
  if (doc.localPath && fs.existsSync(doc.localPath)) {
    return doc.localPath;
  }

  // Try to find in download directory
  if (doc.sourceUrl && doc.dataSet) {
    const filename = decodeURIComponent(doc.sourceUrl.split("/").pop() || "");
    const dsDir = path.join(baseDir, `data-set-${doc.dataSet}`);
    const candidate = path.join(dsDir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

// --- CLI entry point ---

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof classifyAllDocuments>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--reclassify") {
      options.reclassify = true;
    } else if (args[i] === "--download-dir" && args[i + 1]) {
      options.downloadDir = args[++i];
    }
  }

  classifyAllDocuments(options)
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
