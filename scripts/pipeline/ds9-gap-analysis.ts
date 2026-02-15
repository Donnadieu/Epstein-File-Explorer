/**
 * DS9 gap analysis — enumerate local Data Set 9 files and produce a recovery manifest.
 *
 * Data Set 9 is the most legally significant (emails, NPA correspondence) and is
 * incomplete in both DOJ and community archives. This stage scans the local
 * download and extracted dirs, extracts document identifiers from filenames,
 * and writes data/ds9-recovery-manifest.json for use by a DOJ recovery scraper
 * or manual gap-fill.
 *
 * See: docs/EPSTEIN-FILES-ISSUES-AND-PIPELINE-SOLUTIONS.md (Issue 2)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const DS9_DOWNLOAD_DIR = path.join(DOWNLOADS_DIR, "data-set-9");
const DS9_EXTRACTED_DIR = path.join(EXTRACTED_DIR, "ds9");
const MANIFEST_PATH = path.join(DATA_DIR, "ds9-recovery-manifest.json");

/** EFTA-style ID from filename (e.g. EFTA01660679 or 1660679). */
const EFTA_ID_REGEX = /(?:EFTA)?(\d{6,})/i;

export interface Ds9RecoveryManifest {
  generatedAt: string;
  downloadDir: string;
  extractedDir: string;
  /** Total files found in download dir (PDFs and other supported). */
  downloadFileCount: number;
  /** Total extracted JSONs (one per document). */
  extractedFileCount: number;
  /** Unique identifiers parsed from filenames (sorted). */
  presentIds: string[];
  /** If an expected max ID is provided, gaps are [start, end] inclusive. */
  gaps: Array<{ start: number; end: number }>;
  note: string;
}

function walkFiles(dir: string, extensions: Set<string>): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (extensions.has(ext)) out.push(full);
      }
    }
  }
  return out;
}

function extractIdFromFilename(filePath: string): string | null {
  const base = path.basename(filePath, path.extname(filePath));
  const m = base.match(EFTA_ID_REGEX);
  if (m) return m[1].replace(/^0+/, "") || "0";
  if (/^\d+$/.test(base)) return base;
  return null;
}

/**
 * Run DS9 gap analysis: scan local DS9 download and extracted dirs, collect
 * present document IDs, optionally compute gaps if expectedMaxId is set.
 * Writes data/ds9-recovery-manifest.json.
 */
export async function runDs9GapAnalysis(options?: {
  expectedMaxId?: number;
}): Promise<Ds9RecoveryManifest> {
  console.log("\n=== DS9 Gap Analysis ===\n");

  const downloadPdfs = walkFiles(DS9_DOWNLOAD_DIR, new Set([".pdf"]));
  const extractedJsons = walkFiles(DS9_EXTRACTED_DIR, new Set([".json"]));

  const idSet = new Set<string>();
  for (const f of downloadPdfs) {
    const id = extractIdFromFilename(f);
    if (id) idSet.add(id);
  }
  for (const f of extractedJsons) {
    const id = extractIdFromFilename(f);
    if (id) idSet.add(id);
  }

  const presentIds = Array.from(idSet).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
    return na - nb;
  });

  const gaps: Array<{ start: number; end: number }> = [];
  const expectedMaxId = options?.expectedMaxId;
  if (expectedMaxId != null && presentIds.length > 0) {
    const numericIds = presentIds
      .map((s) => parseInt(s, 10))
      .filter((n) => !Number.isNaN(n));
    if (numericIds.length > 0) {
      const minId = Math.min(...numericIds);
      const maxId = Math.max(...numericIds);
      const presentSet = new Set(numericIds);
      let start: number | null = null;
      for (let i = 1; i <= Math.min(expectedMaxId, maxId + 10000); i++) {
        if (!presentSet.has(i)) {
          if (start === null) start = i;
        } else {
          if (start !== null) {
            gaps.push({ start, end: i - 1 });
            start = null;
          }
        }
      }
      if (start !== null) gaps.push({ start, end: expectedMaxId });
    }
  }

  const manifest: Ds9RecoveryManifest = {
    generatedAt: new Date().toISOString(),
    downloadDir: DS9_DOWNLOAD_DIR,
    extractedDir: DS9_EXTRACTED_DIR,
    downloadFileCount: downloadPdfs.length,
    extractedFileCount: extractedJsons.length,
    presentIds,
    gaps,
    note:
      expectedMaxId != null
        ? `Gaps computed against expectedMaxId=${expectedMaxId}. Use presentIds and gaps to drive a DOJ recovery scraper.`
        : "No expectedMaxId provided; gaps not computed. Set expectedMaxId when a community or DOJ upper bound is known.",
  };

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`  Download dir:    ${DS9_DOWNLOAD_DIR}`);
  console.log(`  PDFs found:      ${downloadPdfs.length}`);
  console.log(`  Extracted dir:   ${DS9_EXTRACTED_DIR}`);
  console.log(`  JSONs found:     ${extractedJsons.length}`);
  console.log(`  Unique IDs:      ${presentIds.length}`);
  console.log(`  Gaps (ranges):   ${gaps.length}`);
  console.log(`  Manifest:        ${MANIFEST_PATH}\n`);

  return manifest;
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  let expectedMaxId: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--expected-max-id" && args[i + 1]) {
      expectedMaxId = parseInt(args[++i], 10);
    }
  }
  runDs9GapAnalysis({ expectedMaxId })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
