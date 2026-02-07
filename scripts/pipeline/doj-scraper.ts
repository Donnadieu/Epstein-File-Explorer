import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { chromium, type Browser, type BrowserContext } from "playwright";
import pLimit from "p-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://www.justice.gov";
const EPSTEIN_BASE = `${BASE_URL}/epstein`;
const DOJ_DISCLOSURES = `${EPSTEIN_BASE}/doj-disclosures`;
const COURT_RECORDS = `${EPSTEIN_BASE}/court-records`;
const FOIA_RECORDS = `${EPSTEIN_BASE}/foia-records`;

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;

async function getBrowserContext(): Promise<BrowserContext> {
  if (_context) return _context;
  _browser = await chromium.launch({ headless: true });
  _context = await _browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await _context.addCookies([{
    name: "justiceGovAgeVerified",
    value: "true",
    domain: "www.justice.gov",
    path: "/",
  }]);
  return _context;
}

async function closeBrowser(): Promise<void> {
  if (_context) { await _context.close(); _context = null; }
  if (_browser) { await _browser.close(); _browser = null; }
}

async function fetchPageWithBrowser(url: string): Promise<string> {
  const context = await getBrowserContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000);
    const html = await page.content();
    return html;
  } catch (error: any) {
    console.warn(`  Browser fetch failed for ${url}: ${error.message}`);
    return "";
  } finally {
    await page.close();
  }
}

const DATA_DIR = path.resolve(__dirname, "../../data");
const RAW_DIR = path.join(DATA_DIR, "raw");
const CATALOG_FILE = path.join(DATA_DIR, "doj-catalog.json");

export interface DOJDataSet {
  id: number;
  name: string;
  url: string;
  description: string;
  files: DOJFile[];
  pillar: "doj-disclosures" | "court-records" | "foia" | "house-oversight";
  scrapedAt: string;
}

export interface DOJFile {
  title: string;
  url: string;
  fileType: string;
  sizeBytes?: number;
  dataSetId: number;
  pageCount?: number;
}

export interface DOJCatalog {
  dataSets: DOJDataSet[];
  totalFiles: number;
  lastScraped: string;
  sources: string[];
}

const KNOWN_DATA_SETS: Array<{ id: number; name: string; description: string }> = [
  { id: 1, name: "Data Set 1", description: "FBI investigative files, flight logs, contact books, and early case documents from the Palm Beach investigation (2005-2008)" },
  { id: 2, name: "Data Set 2", description: "FBI 302 interview reports, police reports from Palm Beach, and early correspondence between Epstein's legal team and federal prosecutors" },
  { id: 3, name: "Data Set 3", description: "FBI investigative files including victim statements, witness interviews, and law enforcement correspondence" },
  { id: 4, name: "Data Set 4", description: "FBI Form 302 interview summaries documenting victim statements and recruitment patterns at Epstein's properties" },
  { id: 5, name: "Data Set 5", description: "Grand jury transcripts, SDNY investigation documents, and indictment materials from the 2019 federal case" },
  { id: 6, name: "Data Set 6", description: "Search warrant applications, property inventories from FBI raids on Manhattan mansion, Palm Beach estate, and private island" },
  { id: 7, name: "Data Set 7", description: "Financial records including wire transfers, bank statements, and property transaction documents" },
  { id: 8, name: "Data Set 8", description: "Surveillance footage summaries, MCC records, property records for Little St. James Island, and death investigation materials" },
  { id: 9, name: "Data Set 9", description: "High-value communication records: private email correspondence between Epstein and prominent individuals, internal DOJ correspondence regarding the 2008 NPA" },
  { id: 10, name: "Data Set 10", description: "Visual and forensic media: 180,000+ images and 2,000+ videos seized from Epstein's properties. Female faces redacted for victim protection" },
  { id: 11, name: "Data Set 11", description: "Financial ledgers, additional flight manifests beyond previously published logs, and property seizure records" },
  { id: 12, name: "Data Set 12", description: "Supplemental and late productions: approximately 150 documents requiring prolonged legal review, released January 30, 2026" },
];

async function fetchPage(url: string, retries = 2): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "justiceGovAgeVerified=true",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
      });

      if (response.status === 403 || response.status === 429) {
        const wait = (attempt + 1) * 3000;
        console.warn(`    Rate limited (${response.status}), waiting ${wait / 1000}s (attempt ${attempt + 1}/${retries + 1})...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!response.ok) {
        console.warn(`  Warning: HTTP ${response.status} for ${url}`);
        return "";
      }

      return await response.text();
    } catch (error: any) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      console.warn(`  Warning: Failed to fetch ${url}: ${error.message}`);
      return "";
    }
  }
  return "";
}

function extractFileLinks(html: string, dataSetId: number): DOJFile[] {
  const $ = cheerio.load(html);
  const files: DOJFile[] = [];

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();

    const fileExtensions = [".pdf", ".zip", ".jpg", ".jpeg", ".png", ".mp4", ".avi", ".mov", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"];
    const isFile = fileExtensions.some(ext => href.toLowerCase().endsWith(ext));

    if (isFile && href.length > 0) {
      const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
      const extension = path.extname(href).toLowerCase().replace(".", "");

      files.push({
        title: text || path.basename(href),
        url: fullUrl,
        fileType: extension,
        dataSetId,
      });
    }
  });

  $("a[href*='/files/'], a[href*='/media/'], a[href*='/sites/default/files/']").each((_i, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();

    if (!files.some(f => f.url.includes(href))) {
      const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
      const extension = path.extname(href).toLowerCase().replace(".", "") || "unknown";

      files.push({
        title: text || path.basename(href),
        url: fullUrl,
        fileType: extension,
        dataSetId,
      });
    }
  });

  return files;
}

function extractPaginationInfo(html: string): { lastPage: number } {
  const $ = cheerio.load(html);
  let lastPage = 0;

  $("a[href*='page=']").each((_i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href") || "";
    const match = href.match(/page=(\d+)/);
    if (match) {
      const pageNum = parseInt(match[1], 10);
      if (pageNum > lastPage) lastPage = pageNum;
    }
    if (text === "Last" && match) {
      lastPage = parseInt(match[1], 10);
    }
  });

  return { lastPage };
}

async function scrapeDataSet(dataSet: { id: number; name: string; description: string }): Promise<DOJDataSet> {
  const baseUrl = `${DOJ_DISCLOSURES}/data-set-${dataSet.id}-files`;
  console.log(`  Scraping ${dataSet.name} from ${baseUrl}...`);

  const firstPageHtml = await fetchPageWithBrowser(baseUrl);
  if (!firstPageHtml) {
    console.log(`    No content found`);
    return {
      id: dataSet.id, name: dataSet.name, url: baseUrl,
      description: dataSet.description, files: [],
      pillar: "doj-disclosures", scrapedAt: new Date().toISOString(),
    };
  }

  const allFiles: DOJFile[] = extractFileLinks(firstPageHtml, dataSet.id);
  const seenUrls = new Set(allFiles.map(f => f.url));
  const { lastPage } = extractPaginationInfo(firstPageHtml);

  console.log(`    Page 0: ${allFiles.length} files, ${lastPage + 1} total pages`);

  for (let page = 1; page <= lastPage; page++) {
    await new Promise(r => setTimeout(r, 800));
    const pageUrl = `${baseUrl}?page=${page}`;
    const html = await fetchPageWithBrowser(pageUrl);
    if (!html) continue;

    const pageFiles = extractFileLinks(html, dataSet.id);
    let newCount = 0;
    for (const f of pageFiles) {
      if (!seenUrls.has(f.url)) {
        seenUrls.add(f.url);
        allFiles.push(f);
        newCount++;
      }
    }

    if (page % 10 === 0 || page === lastPage) {
      console.log(`    Page ${page}/${lastPage}: +${newCount} files (total: ${allFiles.length})`);
    }
  }

  console.log(`    Total: ${allFiles.length} file links from ${lastPage + 1} pages`);

  return {
    id: dataSet.id,
    name: dataSet.name,
    url: baseUrl,
    description: dataSet.description,
    files: allFiles,
    pillar: "doj-disclosures",
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeCourtRecords(): Promise<DOJDataSet> {
  console.log("  Scraping Court Records...");
  const html = await fetchPageWithBrowser(COURT_RECORDS);
  const files = html ? extractFileLinks(html, 100) : [];

  console.log(`    Found ${files.length} court record links`);

  return {
    id: 100,
    name: "Court Records - Giuffre v. Maxwell",
    url: COURT_RECORDS,
    description: "Judicial records from Giuffre v. Maxwell civil case (No. 1:15-cv-07433), unsealed throughout 2024-2025 by Judge Loretta Preska. Organized by docket number.",
    files,
    pillar: "court-records",
    scrapedAt: new Date().toISOString(),
  };
}

async function scrapeFOIARecords(): Promise<DOJDataSet> {
  console.log("  Scraping FOIA Records...");
  const html = await fetchPageWithBrowser(FOIA_RECORDS);
  const files = html ? extractFileLinks(html, 200) : [];

  console.log(`    Found ${files.length} FOIA record links`);

  return {
    id: 200,
    name: "FOIA Records",
    url: FOIA_RECORDS,
    description: "Records released under standard Freedom of Information Act requests prior to the Transparency Act. Often contain heavy prior redactions.",
    files,
    pillar: "foia",
    scrapedAt: new Date().toISOString(),
  };
}

export async function scrapeDOJCatalog(): Promise<DOJCatalog> {
  console.log("\n=== DOJ Epstein Library Catalog Scraper ===\n");
  console.log("Scraping all 12 data sets + court records + FOIA records...\n");

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

  const dataSets: DOJDataSet[] = [];

  for (const ds of KNOWN_DATA_SETS) {
    const result = await scrapeDataSet(ds);
    dataSets.push(result);
    await new Promise(r => setTimeout(r, 1000));
  }

  const courtRecords = await scrapeCourtRecords();
  dataSets.push(courtRecords);
  await new Promise(r => setTimeout(r, 1000));

  const foiaRecords = await scrapeFOIARecords();
  dataSets.push(foiaRecords);

  await closeBrowser();

  const totalFiles = dataSets.reduce((sum, ds) => sum + ds.files.length, 0);

  const catalog: DOJCatalog = {
    dataSets,
    totalFiles,
    lastScraped: new Date().toISOString(),
    sources: [
      DOJ_DISCLOSURES,
      COURT_RECORDS,
      FOIA_RECORDS,
      "https://oversight.house.gov/release/oversight-committee-releases-epstein-records-provided-by-the-department-of-justice/",
    ],
  };

  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log(`\nCatalog saved to ${CATALOG_FILE}`);
  console.log(`Total data sets: ${dataSets.length}`);
  console.log(`Total file links discovered: ${totalFiles}`);

  return catalog;
}

// ===== PROBE-BASED DISCOVERY =====
// Complements HTML scraping by sending HEAD requests for sequential EFTA numbers.
// Discovers files not linked on paginated listing pages.

const PROBE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "mp4"] as const;
const MAX_CONSECUTIVE_MISSES = 500;
const PROBE_CONCURRENCY = 15;
const PROBE_BATCH_SIZE = 100;
const PROBE_BATCH_DELAY_MS = 300;

const PROBE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Cookie": "justiceGovAgeVerified=true",
};

async function sendHeadRequest(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      headers: PROBE_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function probeDataSet(dataSet: DOJDataSet): Promise<DOJFile[]> {
  const limit = pLimit(PROBE_CONCURRENCY);

  const eftaNums = dataSet.files
    .map(f => f.title.match(/EFTA(\d+)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => parseInt(m[1], 10));

  if (eftaNums.length === 0) {
    console.log(`    No EFTA files in catalog, skipping probe`);
    return [];
  }

  const firstNum = Math.min(...eftaNums);
  const lastNum = Math.max(...eftaNums);
  const knownUrls = new Set(dataSet.files.map(f => f.url));

  // Fetch pagination to estimate search range (mirrors bash approach)
  const listingUrl = `${DOJ_DISCLOSURES}/data-set-${dataSet.id}-files`;
  const html = await fetchPage(listingUrl);
  const { lastPage } = extractPaginationInfo(html);
  const estimatedTotal = (lastPage + 1) * 50;
  const searchRange = Math.min(estimatedTotal * 3, 50000);
  const rangeEnd = lastNum + searchRange;

  console.log(`    EFTA range: ${firstNum}..${rangeEnd} (last known: ${lastNum}, est. ~${estimatedTotal} files)`);
  console.log(`    Extensions: ${PROBE_EXTENSIONS.join(", ")} | Concurrency: ${PROBE_CONCURRENCY}`);

  const discovered: DOJFile[] = [];
  let consecutiveMisses = 0;
  let checked = 0;
  const dsPath = `https://www.justice.gov/epstein/files/DataSet%20${dataSet.id}`;

  for (let batchStart = firstNum; batchStart <= rangeEnd && consecutiveMisses < MAX_CONSECUTIVE_MISSES; batchStart += PROBE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PROBE_BATCH_SIZE, rangeEnd + 1);
    const batchResults = new Map<number, DOJFile[]>();
    const probes: Promise<void>[] = [];

    for (let n = batchStart; n < batchEnd; n++) {
      const padded = String(n).padStart(8, "0");
      const eftaId = `EFTA${padded}`;
      batchResults.set(n, []);

      for (const ext of PROBE_EXTENSIONS) {
        const url = `${dsPath}/${eftaId}.${ext}`;
        if (knownUrls.has(url)) {
          batchResults.get(n)!.push({ title: `${eftaId}.${ext}`, url, fileType: ext, dataSetId: dataSet.id });
          continue;
        }
        probes.push(limit(async () => {
          if (await sendHeadRequest(url)) {
            batchResults.get(n)!.push({ title: `${eftaId}.${ext}`, url, fileType: ext, dataSetId: dataSet.id });
          }
        }));
      }
    }

    await Promise.all(probes);

    // Process in EFTA-number order for consecutive-miss tracking
    for (let n = batchStart; n < batchEnd; n++) {
      checked++;
      const found = batchResults.get(n)!;
      const padded = String(n).padStart(8, "0");
      const isKnown = PROBE_EXTENSIONS.some(ext =>
        knownUrls.has(`${dsPath}/EFTA${padded}.${ext}`)
      );

      if (found.length > 0 || isKnown) {
        for (const f of found) {
          if (!knownUrls.has(f.url)) {
            discovered.push(f);
            knownUrls.add(f.url);
          }
        }
        consecutiveMisses = 0;
      } else {
        consecutiveMisses++;
      }

      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) break;
    }

    if (checked % 500 < PROBE_BATCH_SIZE) {
      console.log(`    Checked ${checked}: +${discovered.length} new files (${consecutiveMisses} consecutive misses)`);
    }

    await new Promise(r => setTimeout(r, PROBE_BATCH_DELAY_MS));
  }

  const stopReason = consecutiveMisses >= MAX_CONSECUTIVE_MISSES
    ? `${MAX_CONSECUTIVE_MISSES} consecutive misses`
    : "reached range end";
  console.log(`    Done: +${discovered.length} new files (checked ${checked}, stopped: ${stopReason})`);

  return discovered;
}

export async function probeAndMergeCatalog(dataSetFilter?: number[]): Promise<DOJCatalog> {
  console.log("\n=== EFTA Probe-Based Discovery ===\n");

  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error("No existing catalog found at " + CATALOG_FILE + ". Run HTML scraper first.");
  }

  const catalog: DOJCatalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf-8"));
  console.log(`Existing catalog: ${catalog.totalFiles} files across ${catalog.dataSets.length} data sets\n`);

  let totalDiscovered = 0;

  for (const ds of catalog.dataSets) {
    if (ds.id > 12) continue;
    if (dataSetFilter && !dataSetFilter.includes(ds.id)) continue;

    console.log(`  [Data Set ${ds.id}] ${ds.name} (${ds.files.length} known files)`);
    const newFiles = await probeDataSet(ds);

    if (newFiles.length > 0) {
      ds.files.push(...newFiles);
      totalDiscovered += newFiles.length;
    }
    console.log();
  }

  catalog.totalFiles = catalog.dataSets.reduce((sum, ds) => sum + ds.files.length, 0);
  catalog.lastScraped = new Date().toISOString();

  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log(`Probe complete: discovered ${totalDiscovered} new files`);
  console.log(`Updated catalog: ${catalog.totalFiles} total files`);
  console.log(`Saved to ${CATALOG_FILE}`);

  return catalog;
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const mode = process.argv[2];
  if (mode === "probe") {
    const dsArg = process.argv[3];
    const filter = dsArg ? dsArg.split(",").map(Number) : undefined;
    probeAndMergeCatalog(filter).catch(console.error);
  } else {
    scrapeDOJCatalog().catch(console.error);
  }
}
