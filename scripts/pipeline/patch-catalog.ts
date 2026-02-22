/**
 * patch-catalog.ts — Patches doj-catalog.json with resolved extension data.
 *
 * Reads resolved.partial.csv (produced by extension-resolver.ts) and updates
 * the catalog so document-downloader.ts can download files with correct URLs.
 *
 * For each resolved entry:
 *   - If the original .pdf URL exists in the catalog → update url, fileType, title
 *   - If not found → add a new entry to the matching dataset
 *
 * Usage:
 *   npx tsx scripts/pipeline/patch-catalog.ts [resolved-csv] [catalog-json]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { DOJCatalog, DOJFile } from "./doj-scraper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const DEFAULT_RESOLVED_CSV = path.join(DATA_DIR, "resolved.partial.csv");
const DEFAULT_CATALOG = path.join(DATA_DIR, "doj-catalog.json");

interface ResolvedRow {
  base_id: string;
  original_url: string;
  resolved_url: string;
  extension: string;
  status: string;
}

function parseCSV(content: string): ResolvedRow[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",");
  const idx = {
    base_id: header.indexOf("base_id"),
    original_url: header.indexOf("original_url"),
    resolved_url: header.indexOf("resolved_url"),
    extension: header.indexOf("extension"),
    status: header.indexOf("status"),
  };

  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      base_id: cols[idx.base_id],
      original_url: cols[idx.original_url],
      resolved_url: cols[idx.resolved_url],
      extension: cols[idx.extension],
      status: cols[idx.status],
    };
  });
}

function extractDataSetId(url: string): number | null {
  const match = url.match(/DataSet%20(\d+)\//);
  if (match) return parseInt(match[1], 10);
  const match2 = url.match(/DataSet\s+(\d+)\//);
  if (match2) return parseInt(match2[1], 10);
  return null;
}

function main(): void {
  const resolvedPath = process.argv[2] || DEFAULT_RESOLVED_CSV;
  const catalogPath = process.argv[3] || DEFAULT_CATALOG;

  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Resolved CSV not found: ${resolvedPath}`);
    console.error("  Run extension-resolver.ts first.");
    process.exit(1);
  }

  if (!fs.existsSync(catalogPath)) {
    console.error(`❌ Catalog not found: ${catalogPath}`);
    console.error("  Run doj-scraper.ts first, or copy doj-catalog.json to data/.");
    process.exit(1);
  }

  // Load resolved CSV
  const csvContent = fs.readFileSync(resolvedPath, "utf-8");
  const rows = parseCSV(csvContent);
  const resolved = rows.filter((r) => r.status === "resolved");
  console.log(`Loaded ${resolved.length} resolved entries from ${resolvedPath}`);

  // Load catalog
  const catalog: DOJCatalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  console.log(`Loaded catalog with ${catalog.totalFiles} files across ${catalog.dataSets.length} datasets\n`);

  // Index catalog entries by URL for fast lookup
  const urlIndex = new Map<string, { dsIdx: number; fileIdx: number }>();
  for (let dsIdx = 0; dsIdx < catalog.dataSets.length; dsIdx++) {
    const ds = catalog.dataSets[dsIdx];
    for (let fileIdx = 0; fileIdx < ds.files.length; fileIdx++) {
      urlIndex.set(ds.files[fileIdx].url, { dsIdx, fileIdx });
    }
  }

  // Index datasets by ID
  const dsById = new Map<number, number>();
  for (let i = 0; i < catalog.dataSets.length; i++) {
    dsById.set(catalog.dataSets[i].id, i);
  }

  let patched = 0;
  let added = 0;
  let skipped = 0;

  for (const row of resolved) {
    const dsId = extractDataSetId(row.resolved_url);
    if (dsId === null) {
      console.warn(`  Skipping ${row.base_id}: could not extract dataSetId from URL`);
      skipped++;
      continue;
    }

    const newTitle = `${row.base_id}.${row.extension}`;
    const newEntry: DOJFile = {
      title: newTitle,
      url: row.resolved_url,
      fileType: row.extension,
      dataSetId: dsId,
      extensionResolved: true,
    };

    // Check if original .pdf URL exists in catalog
    const existing = urlIndex.get(row.original_url);
    if (existing) {
      catalog.dataSets[existing.dsIdx].files[existing.fileIdx] = newEntry;
      urlIndex.delete(row.original_url);
      urlIndex.set(row.resolved_url, existing);
      patched++;
    } else {
      const dsIdx = dsById.get(dsId);
      if (dsIdx === undefined) {
        console.warn(`  Skipping ${row.base_id}: dataset ${dsId} not found in catalog`);
        skipped++;
        continue;
      }
      catalog.dataSets[dsIdx].files.push(newEntry);
      added++;
    }
  }

  // Update totalFiles
  catalog.totalFiles = catalog.dataSets.reduce((sum, ds) => sum + ds.files.length, 0);

  // Write patched catalog
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

  console.log(`\n✅ Catalog patched: ${catalogPath}`);
  console.log(`  Patched: ${patched} existing entries`);
  console.log(`  Added:   ${added} new entries`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total files in catalog: ${catalog.totalFiles}`);
}

main();
