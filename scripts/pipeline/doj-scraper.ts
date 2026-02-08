import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { chromium, type BrowserContext, type Page } from "playwright";
import pLimit from "p-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://www.justice.gov";
const EPSTEIN_BASE = `${BASE_URL}/epstein`;
const DOJ_DISCLOSURES = `${EPSTEIN_BASE}/doj-disclosures`;
const COURT_RECORDS = `${EPSTEIN_BASE}/court-records`;
const FOIA_RECORDS = `${EPSTEIN_BASE}/foia-records`;

let _context: BrowserContext | null = null;

// Use headed mode to see the browser window (DOJ_HEADED=1 or --headed flag)
const USE_HEADED = process.env.DOJ_HEADED === "1" || process.argv.includes("--headed");

// Persistent Chrome profile directory — preserves cookies/state across runs
const CHROME_PROFILE_DIR = path.resolve(__dirname, "../../data/.chrome-profile");

export async function getBrowserContext(): Promise<BrowserContext> {
  if (_context) return _context;

  // Ensure profile directory exists
  if (!fs.existsSync(CHROME_PROFILE_DIR)) {
    fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
  }

  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    channel: "chrome",
    headless: !USE_HEADED,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  };

  try {
    _context = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, launchOptions);
    console.log("  Using system Chrome with persistent profile");
  } catch (err: any) {
    // Fall back to bundled Chromium if system Chrome isn't available
    console.warn(`  System Chrome not available (${err.message}), falling back to bundled Chromium`);
    delete launchOptions.channel;
    _context = await chromium.launchPersistentContext(CHROME_PROFILE_DIR, launchOptions);
  }

  if (USE_HEADED) console.log("  (Running in headed mode — visible browser window)");

  // Defense-in-depth: hide webdriver property
  await _context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  // Pre-set age verification cookie to bypass age gate redirects
  await _context.addCookies([{
    name: "justiceGovAgeVerified",
    value: "true",
    domain: ".justice.gov",
    path: "/",
  }]);
  return _context;
}

export async function closeBrowser(): Promise<void> {
  // Persistent context owns the browser lifecycle — closing it closes everything
  if (_context) { await _context.close(); _context = null; }
}

/** Solve the Akamai bot challenge ("I am not a robot") if present. */
async function solveBotChallenge(page: Page): Promise<boolean> {
  const isChallenge = await page.evaluate(() => {
    return document.body?.innerHTML?.includes("reauth") ||
      !!document.querySelector("input[value='I am not a robot']");
  });

  if (!isChallenge) return false;

  console.log("      Bot challenge detected, solving...");
  // Wait for the abuse-deterrent.js script to define SHA256/setCookie
  await page.waitForTimeout(2000);

  const button = page.locator("input[value='I am not a robot']");
  if (await button.isVisible({ timeout: 3000 }).catch(() => false)) {
    await button.click();
    await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Check if challenge reappears (may need multiple attempts)
    const stillChallenge = await page.evaluate(() =>
      !!document.querySelector("input[value='I am not a robot']")
    );
    if (stillChallenge) {
      console.log("      Challenge persisted, retrying...");
      await page.waitForTimeout(2000);
      await button.click().catch(() => {});
      await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  }
  return true;
}

/** Click the age verification "Yes" button if present. */
async function handleAgeGate(page: Page): Promise<void> {
  const hasAgeGate = await page.evaluate(() =>
    document.body?.innerText?.includes("Are you 18 years of age or older")
  );
  if (!hasAgeGate) return;

  console.log("      Age gate found, clicking Yes...");
  // Use JavaScript click to bypass overlay that intercepts pointer events
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector("#age-button-yes") as HTMLButtonElement;
    if (btn) { btn.click(); return true; }
    // Fallback: find any button with "Yes" text
    const buttons = document.querySelectorAll("button");
    for (const b of buttons) {
      if (b.textContent?.trim() === "Yes") { b.click(); return true; }
    }
    return false;
  });

  if (clicked) {
    await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
}

/** Navigate to a URL with bot challenge and age gate handling. */
async function navigateAndPrepare(page: Page, url: string): Promise<boolean> {
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  await solveBotChallenge(page);
  await handleAgeGate(page);

  // Verify we have actual content (not a blocked/empty page)
  const hasContent = await page.evaluate(() => {
    const links = document.querySelectorAll("a[href*='.pdf'], a[href*='/files/']");
    const hasPager = !!document.querySelector("nav.usa-pagination");
    return links.length > 0 || hasPager;
  });

  return hasContent;
}

/** Extract file links directly from a Playwright page (no cheerio needed). */
async function extractFileLinksFromPage(page: Page, dataSetId: number): Promise<DOJFile[]> {
  return page.evaluate((args) => {
    const { dataSetId, baseUrl } = args;
    const files: Array<{ title: string; url: string; fileType: string; dataSetId: number }> = [];
    const seen = new Set<string>();
    const extensions = [".pdf", ".zip", ".jpg", ".jpeg", ".png", ".mp4", ".avi", ".mov", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"];

    document.querySelectorAll("a[href]").forEach(el => {
      const href = el.getAttribute("href") || "";
      if (href.includes("mailto:")) return;

      const isFile = extensions.some(ext => href.toLowerCase().endsWith(ext));
      const isMedia = href.includes("/files/") || href.includes("/media/") || href.includes("/sites/default/files/");

      if ((isFile || isMedia) && href.length > 0) {
        const fullUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);

        const pathname = fullUrl.split("?")[0].split("#")[0];
        const lastSegment = pathname.split("/").pop() || "";
        const dotIdx = lastSegment.lastIndexOf(".");
        const ext = dotIdx > 0 ? lastSegment.slice(dotIdx + 1).toLowerCase() : "unknown";
        const text = el.textContent?.trim() || fullUrl.split("/").pop() || "";

        files.push({ title: text, url: fullUrl, fileType: ext, dataSetId });
      }
    });

    return files;
  }, { dataSetId, baseUrl: BASE_URL });
}

/** Get the last page number from the pagination widget only (not the whole page). */
async function getLastPageFromPager(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pager = document.querySelector("nav.usa-pagination");
    if (!pager) return 0;

    let lastPage = 0;
    pager.querySelectorAll("a[href*='page=']").forEach(a => {
      const href = a.getAttribute("href") || "";
      const match = href.match(/page=(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > lastPage) lastPage = num;
      }
    });
    return lastPage;
  });
}

/** Click the Next pagination link within the pager widget. Returns false if no Next link. */
async function clickNextPage(page: Page): Promise<boolean> {
  const nextLink = page.locator("nav.usa-pagination li.usa-pagination__item--next a, nav.usa-pagination a[aria-label='Next page']").first();

  if (!await nextLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Also try by text content within the pager
    const altNext = page.locator("nav.usa-pagination a:has-text('Next')").first();
    if (!await altNext.isVisible({ timeout: 1000 }).catch(() => false)) {
      return false;
    }
    await altNext.click();
  } else {
    await nextLink.click();
  }

  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await solveBotChallenge(page);
  return true;
}

/** Extract cookies from Playwright context as a header string for use in fetch requests. */
export async function extractCookieHeader(): Promise<string> {
  const context = await getBrowserContext();
  const cookies = await context.cookies();
  return cookies.map(c => `${c.name}=${c.value}`).join("; ");
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
  pageCount?: number;
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

async function scrapeDataSet(dataSet: { id: number; name: string; description: string }): Promise<DOJDataSet> {
  const baseUrl = `${DOJ_DISCLOSURES}/data-set-${dataSet.id}-files`;
  console.log(`  Scraping ${dataSet.name} from ${baseUrl}...`);

  const context = await getBrowserContext();
  const page = await context.newPage();

  try {
    const hasContent = await navigateAndPrepare(page, baseUrl);
    if (!hasContent) {
      console.log(`    No content found (page may be blocked)`);
      return {
        id: dataSet.id, name: dataSet.name, url: baseUrl,
        description: dataSet.description, files: [],
        pillar: "doj-disclosures", scrapedAt: new Date().toISOString(),
      };
    }

    const allFiles: DOJFile[] = [];
    const seenUrls = new Set<string>();
    const lastPage = await getLastPageFromPager(page);

    // Extract files from page 0
    const p0Files = await extractFileLinksFromPage(page, dataSet.id);
    for (const f of p0Files) {
      if (!seenUrls.has(f.url)) { seenUrls.add(f.url); allFiles.push(f); }
    }
    console.log(`    Page 0: ${allFiles.length} files, ${lastPage + 1} total pages`);

    // Navigate through subsequent pages using click navigation
    // System Chrome with persistent profile passes Akamai checks for pagination
    let emptyPages = 0;

    for (let pageNum = 1; pageNum <= lastPage; pageNum++) {
      const nextClicked = await clickNextPage(page);
      if (!nextClicked) {
        console.log(`    Page ${pageNum}: no Next link found, stopping pagination`);
        break;
      }

      await page.waitForTimeout(1500 + Math.random() * 1000);
      const pageFiles = await extractFileLinksFromPage(page, dataSet.id);

      let newCount = 0;
      for (const f of pageFiles) {
        if (!seenUrls.has(f.url)) { seenUrls.add(f.url); allFiles.push(f); newCount++; }
      }

      if (pageNum % 10 === 0 || pageNum === lastPage) {
        console.log(`    Page ${pageNum}/${lastPage}: +${newCount} files (total: ${allFiles.length})`);
      }

      // Stop if 3 consecutive pages have no new files
      if (newCount === 0) {
        emptyPages++;
        if (emptyPages >= 3) {
          console.log(`    Stopping: ${emptyPages} consecutive pages with no new files`);
          break;
        }
      } else {
        emptyPages = 0;
      }

      // Rate limit between pages
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`    Total: ${allFiles.length} file links`);

    return {
      id: dataSet.id,
      name: dataSet.name,
      url: baseUrl,
      description: dataSet.description,
      files: allFiles,
      pillar: "doj-disclosures",
      scrapedAt: new Date().toISOString(),
      pageCount: lastPage + 1,
    };
  } finally {
    await page.close();
  }
}

async function scrapeCourtRecords(): Promise<DOJDataSet> {
  console.log("  Scraping Court Records...");
  const context = await getBrowserContext();
  const page = await context.newPage();
  let files: DOJFile[] = [];

  try {
    const hasContent = await navigateAndPrepare(page, COURT_RECORDS);
    if (hasContent) {
      files = await extractFileLinksFromPage(page, 100);
    }
  } finally {
    await page.close();
  }

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
  const context = await getBrowserContext();
  const page = await context.newPage();
  let files: DOJFile[] = [];

  try {
    const hasContent = await navigateAndPrepare(page, FOIA_RECORDS);
    if (hasContent) {
      files = await extractFileLinksFromPage(page, 200);
    }
  } finally {
    await page.close();
  }

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

export async function scrapeDOJCatalog(dataSetFilter?: number[]): Promise<DOJCatalog> {
  const filterLabel = dataSetFilter ? `data sets ${dataSetFilter.join(", ")}` : "all 12 data sets + court records + FOIA records";
  console.log("\n=== DOJ Epstein Library Catalog Scraper ===\n");
  console.log(`Scraping ${filterLabel}...\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

  // Load existing catalog so we can merge in new data sets
  let existingDataSets: DOJDataSet[] = [];
  if (fs.existsSync(CATALOG_FILE)) {
    try {
      const existing: DOJCatalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf-8"));
      existingDataSets = existing.dataSets;
    } catch {}
  }

  // Start with existing data sets that we're NOT re-scraping
  const dataSets: DOJDataSet[] = dataSetFilter
    ? existingDataSets.filter(ds => !dataSetFilter.includes(ds.id))
    : [];

  const saveCatalog = () => {
    const totalFiles = dataSets.reduce((sum, ds) => sum + ds.files.length, 0);
    const catalog: DOJCatalog = {
      dataSets: [...dataSets].sort((a, b) => a.id - b.id),
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
    return { catalog, totalFiles };
  };

  const shouldScrapeDS = (id: number) => !dataSetFilter || dataSetFilter.includes(id);

  for (const ds of KNOWN_DATA_SETS) {
    if (!shouldScrapeDS(ds.id)) {
      console.log(`  Skipping Data Set ${ds.id} (already cataloged, ${existingDataSets.find(e => e.id === ds.id)?.files.length ?? 0} files)\n`);
      continue;
    }
    const result = await scrapeDataSet(ds);
    dataSets.push(result);
    saveCatalog();
    await new Promise(r => setTimeout(r, 1000));
  }

  if (shouldScrapeDS(100)) {
    const courtRecords = await scrapeCourtRecords();
    dataSets.push(courtRecords);
    saveCatalog();
    await new Promise(r => setTimeout(r, 1000));
  }

  if (shouldScrapeDS(200)) {
    const foiaRecords = await scrapeFOIARecords();
    dataSets.push(foiaRecords);
  }

  await closeBrowser();

  const { catalog, totalFiles } = saveCatalog();
  console.log(`\nCatalog saved to ${CATALOG_FILE}`);
  console.log(`Total data sets: ${dataSets.length}`);
  console.log(`Total file links discovered: ${totalFiles}`);

  console.log("\n=== RESULTS ===");
  for (const ds of dataSets) {
    console.log(`  ${ds.name}: ${ds.files.length} files`);
  }
  console.log(`\nTotal: ${totalFiles} files`);

  return catalog;
}

// ===== PROBE-BASED DISCOVERY =====
// Complements HTML scraping by sending HEAD requests for sequential EFTA numbers.
// Discovers files not linked on paginated listing pages.

const PROBE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "mp4"] as const;
const DEFAULT_MAX_CONSECUTIVE_MISSES = 500;
const PROBE_CONCURRENCY = 30;
const PROBE_BATCH_SIZE = 200;
const PROBE_BATCH_DELAY_MS = 200;

const PROBE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Cookie": "justiceGovAgeVerified=true",
};

async function sendHeadRequest(url: string, cookieHeader?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { ...PROBE_HEADERS };
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }
    const resp = await fetch(url, {
      method: "HEAD",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.status !== 200) return false;

    // Validate this is an actual file, not the Akamai bot challenge page
    // The bot challenge returns text/html with ~9172 bytes for ALL URLs
    const contentType = resp.headers.get("content-type") || "";
    const contentLength = parseInt(resp.headers.get("content-length") || "0", 10);
    return !contentType.includes("text/html") && contentLength > 10000;
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

  // Solve bot challenge first so cookies are available for HEAD requests
  // Also extract page count from the pager to estimate file range
  const context = await getBrowserContext();
  const probePage = await context.newPage();
  let lastPage = 0;
  try {
    const listingUrl = `${DOJ_DISCLOSURES}/data-set-${dataSet.id}-files`;
    await navigateAndPrepare(probePage, listingUrl);
    lastPage = await getLastPageFromPager(probePage);
  } finally {
    await probePage.close();
  }
  const cookieHeader = await extractCookieHeader();

  // Use stored pageCount from catalog if live pager extraction failed
  const pageCount = lastPage > 0 ? lastPage + 1 : (dataSet.pageCount || 1);

  const firstNum = Math.min(...eftaNums);
  const lastNum = Math.max(...eftaNums);
  const knownUrls = new Set(dataSet.files.map(f => f.url));

  // Estimate search range from page count (each page has ~50 files)
  const estimatedTotal = Math.max(dataSet.files.length, pageCount * 50);
  const searchRange = Math.min(estimatedTotal * 3, 100000);
  const rangeEnd = lastNum + searchRange;

  // Scale consecutive miss limit based on expected file density
  // DS with 64 pages = ~3200 files, so allow up to 6400 misses
  const maxConsecutiveMisses = Math.min(Math.max(DEFAULT_MAX_CONSECUTIVE_MISSES, pageCount * 100), 10000);

  console.log(`    EFTA range: ${firstNum}..${rangeEnd} (last known: ${lastNum}, est. ~${estimatedTotal} files, max misses: ${maxConsecutiveMisses})`);
  console.log(`    Extensions: ${PROBE_EXTENSIONS.join(", ")} | Concurrency: ${PROBE_CONCURRENCY}`);

  const discovered: DOJFile[] = [];
  let consecutiveMisses = 0;
  let checked = 0;
  const dsPath = `https://www.justice.gov/epstein/files/DataSet%20${dataSet.id}`;

  for (let batchStart = firstNum; batchStart <= rangeEnd && consecutiveMisses < maxConsecutiveMisses; batchStart += PROBE_BATCH_SIZE) {
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
          if (await sendHeadRequest(url, cookieHeader)) {
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

      if (consecutiveMisses >= maxConsecutiveMisses) break;
    }

    if (checked % 500 < PROBE_BATCH_SIZE) {
      console.log(`    Checked ${checked}: +${discovered.length} new files (${consecutiveMisses} consecutive misses)`);
    }

    await new Promise(r => setTimeout(r, PROBE_BATCH_DELAY_MS));
  }

  const stopReason = consecutiveMisses >= maxConsecutiveMisses
    ? `${maxConsecutiveMisses} consecutive misses`
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
  const dsArg = process.argv[3];
  const filter = dsArg ? dsArg.split(",").map(Number) : undefined;
  if (mode === "probe") {
    probeAndMergeCatalog(filter).catch(console.error);
  } else {
    scrapeDOJCatalog(filter).catch(console.error);
  }
}
