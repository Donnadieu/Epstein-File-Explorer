import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://www.justice.gov";
const EPSTEIN_BASE = `${BASE_URL}/epstein`;
const DOJ_DISCLOSURES = `${EPSTEIN_BASE}/doj-disclosures`;
const COURT_RECORDS = `${EPSTEIN_BASE}/court-records`;
const FOIA_RECORDS = `${EPSTEIN_BASE}/foia-records`;

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

  const firstPageHtml = await fetchPage(baseUrl);
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
    await new Promise(r => setTimeout(r, 500));
    const pageUrl = `${baseUrl}?page=${page}`;
    const html = await fetchPage(pageUrl);
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
  const html = await fetchPage(COURT_RECORDS);
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
  const html = await fetchPage(FOIA_RECORDS);
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

if (process.argv[1]?.includes(path.basename(__filename))) {
  scrapeDOJCatalog().catch(console.error);
}
