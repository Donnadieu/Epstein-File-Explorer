import type { Express } from "express";
import { createServer, type Server } from "http";
import { Readable } from "stream";
import * as fsSync from "fs";
import * as pathMod from "path";
import * as os from "os";
import { createHash } from "crypto";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import pLimit from "p-limit";
import { insertBookmarkSchema } from "@shared/schema";
import { storage } from "./storage";
import { isR2Configured, getPresignedUrl, getR2Stream } from "./r2";
import { registerChatRoutes } from "./chat";

let activeProxyStreams = 0;
const MAX_PROXY_STREAMS = 10;

const ALLOWED_PDF_DOMAINS = [
  "www.justice.gov",
  "justice.gov",
  "www.courtlistener.com",
  "courtlistener.com",
  "storage.courtlistener.com",
  "www.uscourts.gov",
  "uscourts.gov",
  "archive.org",
  "ia800500.us.archive.org",
];

function omitInternal<T extends Record<string, unknown>>(doc: T): Omit<T, 'localPath' | 'r2Key' | 'fileHash'> {
  const { localPath, r2Key, fileHash, ...rest } = doc as any;
  return rest;
}

function isAllowedPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_PDF_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith("." + d)
    );
  } catch {
    return false;
  }
}

/**
 * Validate and resolve a file path to ensure it stays within allowed base directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd)
 */
function validatePath(userPath: string, baseDir: string = pathMod.join(process.cwd(), "data")): { success: boolean; resolvedPath?: string; error?: string } {
  try {
    // Resolve relative paths and symlinks
    const resolved = pathMod.resolve(userPath);
    const resolvedBase = pathMod.resolve(baseDir);

    // Ensure the resolved path is within the base directory
    if (!resolved.startsWith(resolvedBase)) {
      return { success: false, error: "Access denied: path outside allowed directory" };
    }

    return { success: true, resolvedPath: resolved };
  } catch (error) {
    return { success: false, error: `Invalid path: ${(error as Error).message}` };
  }
}

/**
 * API Key middleware for /api/tools/* endpoints
 * Checks for X-API-Key header (can be configured via environment)
 */
function apiKeyMiddleware(req: any, res: any, next: any) {
  // Skip auth if no API key is configured (for backwards compatibility during transition)
  const requiredKey = process.env.TOOLS_API_KEY;
  if (!requiredKey) {
    return next();
  }

  const providedKey = req.get("X-API-Key");
  if (!providedKey || providedKey !== requiredKey) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid X-API-Key header" });
  }

  next();
}


function escapeCsvField(value: unknown): string {
  const str = String(value ?? "");
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsvRow(headers: string[], obj: Record<string, unknown>): string {
  return headers.map(h => escapeCsvField(obj[h])).join(",");
}

const DOJ_DISCLOSURES_URL = "https://www.justice.gov/epstein/doj-disclosures";
const DOJ_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Cookie": "justiceGovAgeVerified=true",
};

function toAbsoluteUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(?:$|\?)/i.test(url);
}

function isLikelyDojFileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";

    if (!/(^|\.)justice\.gov$/i.test(parsed.hostname) && !/\.justice\.gov$/i.test(parsed.hostname)) {
      return false;
    }

    if (isPdfUrl(url)) return true;

    if (/\/epstein\/files\//i.test(pathname) && /EFTA\d{8,}/i.test(pathname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function normalizeEmail(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^[<\[("']+/, "")
    .replace(/[>\])"'.,;:!?]+$/, "")
    .toLowerCase();

  if (!cleaned.includes("@")) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) return null;
  if (cleaned.includes("..")) return null;
  return cleaned;
}

function extractEmailsFromValue(value: unknown): string[] {
  if (value == null) return [];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return [];

  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  const unique = new Set<string>();

  for (const match of matches) {
    const normalized = normalizeEmail(match);
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function extractObfuscatedEmailsFromText(text: string): string[] {
  const unique = new Set<string>();
  const pattern = /\b([a-zA-Z0-9._%+-]{1,64})\s*(?:@|\(at\)|\[at\]|\sat\s)\s*([a-zA-Z0-9.-]{1,253})\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*([a-zA-Z]{2,24})\b/g;

  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const candidate = `${match[1]}@${match[2]}.${match[3]}`;
    const normalized = normalizeEmail(candidate);
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function extractEmailsFromAnalysisParts(parts: unknown[]): string[] {
  const unique = new Set<string>();

  for (const part of parts) {
    for (const email of extractEmailsFromValue(part)) {
      unique.add(email);
    }

    const rawText = typeof part === "string" ? part : JSON.stringify(part);
    if (rawText) {
      for (const email of extractObfuscatedEmailsFromText(rawText)) {
        unique.add(email);
      }
    }
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function summarizeEmailDomains(emails: string[], maxDomains = 5): string[] {
  const counts = new Map<string, number>();
  for (const email of emails) {
    const domain = email.split("@")[1];
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxDomains)
    .map(([domain, count]) => `${domain} (${count})`);
}

function normalizeUrlForDedup(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function isSameDojDatasetPage(candidateUrl: string, rootUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const root = new URL(rootUrl);
    if (candidate.origin !== root.origin) return false;
    const candidatePath = candidate.pathname.replace(/\/$/, "");
    const rootPath = root.pathname.replace(/\/$/, "");

    if (candidatePath !== rootPath && !candidatePath.startsWith(`${rootPath}/page/`)) {
      return false;
    }

    const pageParam = candidate.searchParams.get("page");
    if (pageParam && /^\d+$/i.test(pageParam)) return true;

    const pagerPathMatch = candidatePath.match(/\/page\/(\d+)$/i);
    if (pagerPathMatch) return true;

    return false;
  } catch {
    return false;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: DOJ_FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

type DoiJobProgress = {
  discovered: number;
  total: number;
  processed: number;
  successful: number;
  failed: number;
  currentUrl?: string;
  phase?: "discovering" | "processing";
  pagesScanned?: number;
};

class DoiBatchCancelledError extends Error {
  constructor() {
    super("DOJ batch audit cancelled by user");
    this.name = "DoiBatchCancelledError";
  }
}

function throwIfCancelled(shouldStop?: () => boolean): void {
  if (shouldStop?.()) {
    throw new DoiBatchCancelledError();
  }
}

async function discoverDojDisclosurePdfUrls(
  onProgress?: (state: { pagesScanned: number; pdfsFound: number; currentPage?: string }) => void,
  shouldStop?: () => boolean,
): Promise<string[]> {
  throwIfCancelled(shouldStop);
  const disclosuresHtml = await fetchHtml(DOJ_DISCLOSURES_URL);
  const $root = cheerio.load(disclosuresHtml);

  const dataSetRoots = new Set<string>();
  $root("a[href]").each((_idx, element) => {
    const href = $root(element).attr("href") || "";
    const absolute = toAbsoluteUrl(href, DOJ_DISCLOSURES_URL);
    if (!absolute) return;

    const match = absolute.match(/\/epstein\/doj-disclosures\/data-set-(\d+)-files/i);
    if (match) {
      dataSetRoots.add(`https://www.justice.gov/epstein/doj-disclosures/data-set-${match[1]}-files`);
    }
  });

  if (dataSetRoots.size === 0) {
    for (let i = 1; i <= 12; i++) {
      dataSetRoots.add(`https://www.justice.gov/epstein/doj-disclosures/data-set-${i}-files`);
    }
  }

  const pdfUrls = new Set<string>();
  let pagesScanned = 0;

  for (const rootUrl of dataSetRoots) {
    throwIfCancelled(shouldStop);
    const queue: string[] = [rootUrl];
    const visited = new Set<string>();

    while (queue.length > 0 && visited.size < 300) {
      throwIfCancelled(shouldStop);
      const pageUrl = normalizeUrlForDedup(queue.shift()!);
      if (visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      pagesScanned += 1;

      if (onProgress) {
        onProgress({ pagesScanned, pdfsFound: pdfUrls.size, currentPage: pageUrl });
      }

      let html: string;
      try {
        throwIfCancelled(shouldStop);
        html = await fetchHtml(pageUrl);
      } catch {
        continue;
      }

      const $ = cheerio.load(html);

      const nextHref = $('a[rel="next"]').first().attr("href");
      if (nextHref) {
        const nextUrl = toAbsoluteUrl(nextHref, pageUrl);
        if (nextUrl) {
          const normalizedNextUrl = normalizeUrlForDedup(nextUrl);
          if (!visited.has(normalizedNextUrl)) {
            queue.push(normalizedNextUrl);
          }
        }
      }

      $("a[href]").each((_idx, element) => {
        if (shouldStop?.()) {
          return false;
        }
        const href = $(element).attr("href") || "";
        const absolute = toAbsoluteUrl(href, pageUrl);
        if (!absolute) return;

        const normalizedAbsolute = normalizeUrlForDedup(absolute);

        if (isLikelyDojFileUrl(normalizedAbsolute)) {
          pdfUrls.add(normalizedAbsolute);
          if (onProgress) {
            onProgress({ pagesScanned, pdfsFound: pdfUrls.size, currentPage: pageUrl });
          }
          return;
        }

        if (isSameDojDatasetPage(normalizedAbsolute, rootUrl) && !visited.has(normalizedAbsolute)) {
          queue.push(normalizedAbsolute);
        }
      });
    }
  }

  return Array.from(pdfUrls).sort((a, b) => a.localeCompare(b));
}

async function downloadDojPdfToCache(sourceUrl: string, cacheDir: string): Promise<string> {
  const parsed = new URL(sourceUrl);
  const baseNameRaw = pathMod.basename(parsed.pathname) || "document.pdf";
  const baseName = baseNameRaw.toLowerCase().endsWith(".pdf") ? baseNameRaw : `${baseNameRaw}.pdf`;
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 12);
  const localPath = pathMod.join(cacheDir, `${hash}-${safeName}`);

  if (fsSync.existsSync(localPath) && fsSync.statSync(localPath).size > 0) {
    return localPath;
  }

  const response = await fetch(sourceUrl, {
    headers: {
      ...DOJ_FETCH_HEADERS,
      Accept: "application/pdf,application/octet-stream,*/*",
      Referer: DOJ_DISCLOSURES_URL,
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("pdf") && !contentType.includes("octet-stream") && !isPdfUrl(sourceUrl)) {
    throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
  }

  const buffer = await response.buffer();
  if (!buffer.length) {
    throw new Error("Downloaded empty file");
  }

  fsSync.writeFileSync(localPath, buffer);
  return localPath;
}

type BatchFilter = "all" | "hits" | "vulnerable" | "recoverable";

type DoiBatchResultItem = {
  filename: string;
  path: string;
  source_url: string;
  success: boolean;
  pages: number;
  has_vulnerabilities: boolean;
  has_recoverable_text: boolean;
  audit_type: string;
  metadata_present: boolean;
  unredacted_generated: boolean;
  email_count: number;
  emails_preview: string[];
  email_domains: string[];
  has_emails: boolean;
  is_hit: boolean;
  error?: string;
};

type DoiBatchSummary = {
  total: number;
  analyzed: number;
  hits: number;
  vulnerable: number;
  recoverable: number;
  with_metadata: number;
  with_emails: number;
  email_addresses_total: number;
};

type DoiBatchPayload = {
  results: DoiBatchResultItem[];
  summary: DoiBatchSummary;
  discovered: number;
};

type EmailAuditResultItem = {
  file: string;
  email_count: number;
  emails_preview: string[];
  email_domains: string[];
};

type EmailAuditSummary = {
  files_scanned: number;
  files_with_emails: number;
  email_addresses_total: number;
};

function runAiAnalyzedEmailAudit(maxFiles?: number): { results: EmailAuditResultItem[]; summary: EmailAuditSummary } {
  const aiDir = pathMod.join(process.cwd(), "data", "ai-analyzed");
  if (!fsSync.existsSync(aiDir)) {
    return {
      results: [],
      summary: {
        files_scanned: 0,
        files_with_emails: 0,
        email_addresses_total: 0,
      },
    };
  }

  const jsonFiles = fsSync
    .readdirSync(aiDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const limited = Number.isFinite(Number(maxFiles)) && Number(maxFiles) > 0
    ? jsonFiles.slice(0, Math.floor(Number(maxFiles)))
    : jsonFiles;

  const results: EmailAuditResultItem[] = [];
  let emailTotal = 0;

  for (const fileName of limited) {
    const filePath = pathMod.join(aiDir, fileName);
    let content = "";
    try {
      content = fsSync.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const emails = extractEmailsFromAnalysisParts([content]);
    if (emails.length === 0) continue;

    emailTotal += emails.length;
    results.push({
      file: fileName,
      email_count: emails.length,
      emails_preview: emails.slice(0, 10),
      email_domains: summarizeEmailDomains(emails, 10),
    });
  }

  results.sort((a, b) => b.email_count - a.email_count || a.file.localeCompare(b.file));

  return {
    results,
    summary: {
      files_scanned: limited.length,
      files_with_emails: results.length,
      email_addresses_total: emailTotal,
    },
  };
}

function applyDojFilter(results: DoiBatchResultItem[], filter: BatchFilter): DoiBatchResultItem[] {
  if (filter === "vulnerable") return results.filter((r) => r.has_vulnerabilities);
  if (filter === "recoverable") return results.filter((r) => r.has_recoverable_text);
  if (filter === "hits") return results.filter((r) => r.is_hit);
  return results;
}

function buildDojSummary(allResults: DoiBatchResultItem[], filtered: DoiBatchResultItem[], total: number): DoiBatchSummary {
  return {
    total,
    analyzed: allResults.filter((r) => r.success).length,
    hits: filtered.filter((r) => r.is_hit).length,
    vulnerable: filtered.filter((r) => r.has_vulnerabilities).length,
    recoverable: filtered.filter((r) => r.has_recoverable_text).length,
    with_metadata: filtered.filter((r) => r.metadata_present).length,
    with_emails: filtered.filter((r) => r.has_emails).length,
    email_addresses_total: filtered.reduce((sum, r) => sum + (r.email_count || 0), 0),
  };
}

async function performDojBatchAudit(
  options: { filter?: BatchFilter; maxFiles?: number },
  onProgress?: (progress: DoiJobProgress) => void,
  shouldStop?: () => boolean,
): Promise<DoiBatchPayload> {
  throwIfCancelled(shouldStop);
  const filter = options.filter ?? "all";
  const parsedMax = Number(options.maxFiles);
  const maxToAnalyze = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : undefined;

  if (onProgress) {
    onProgress({
      discovered: 0,
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      phase: "discovering",
      pagesScanned: 0,
    });
  }

  const discoveredUrls = await discoverDojDisclosurePdfUrls((state) => {
    if (!onProgress) return;
    onProgress({
      discovered: state.pdfsFound,
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      currentUrl: state.currentPage,
      phase: "discovering",
      pagesScanned: state.pagesScanned,
    });
  }, shouldStop);
  throwIfCancelled(shouldStop);
  const urls = maxToAnalyze ? discoveredUrls.slice(0, maxToAnalyze) : discoveredUrls;

  if (onProgress) {
    onProgress({
      discovered: discoveredUrls.length,
      total: urls.length,
      processed: 0,
      successful: 0,
      failed: 0,
      phase: "processing",
    });
  }

  if (urls.length === 0) {
    return {
      results: [],
      summary: buildDojSummary([], [], 0),
      discovered: discoveredUrls.length,
    };
  }

  const cacheDir = pathMod.join(os.tmpdir(), "epstein-pdf-analysis", "doj-library");
  fsSync.mkdirSync(cacheDir, { recursive: true });

  const limit = pLimit(2);
  let processed = 0;
  let successful = 0;
  let failed = 0;

  const allResults = await Promise.all(
    urls.map((sourceUrl) =>
      limit(async () => {
        throwIfCancelled(shouldStop);
        let result: DoiBatchResultItem;
        try {
          const localPath = await downloadDojPdfToCache(sourceUrl, cacheDir);
          throwIfCancelled(shouldStop);
          const pytools = (await import("./python-tools.js")).default;
          const analysis = await pytools.analyzePDF(localPath);

          const wordsRecovered = Number((analysis.unredactionStats as any)?.words_under_redactions || 0);
          const extractedEmails = extractEmailsFromAnalysisParts([
            analysis.extractedText,
            analysis.metadata,
            analysis.audit,
          ]);

          if (analysis.unredactedPath && fsSync.existsSync(analysis.unredactedPath)) {
            try {
              const unredExtract = await pytools.runTextExtraction(analysis.unredactedPath);
              if (unredExtract.success && unredExtract.outputPath && fsSync.existsSync(unredExtract.outputPath)) {
                const unredText = JSON.parse(fsSync.readFileSync(unredExtract.outputPath, "utf-8"));
                const recovered = extractEmailsFromAnalysisParts([unredText]);
                for (const email of recovered) extractedEmails.push(email);
              }
            } catch {
              // Non-fatal; keep primary extraction results
            }
          }

          const uniqueEmails = Array.from(new Set(extractedEmails)).sort((a, b) => a.localeCompare(b));
          result = {
            filename: pathMod.basename(localPath),
            path: localPath,
            source_url: sourceUrl,
            success: analysis.success,
            pages: Number((analysis.audit as any)?.pages || 0),
            has_vulnerabilities: !!(analysis.xray && Object.keys(analysis.xray).length > 0),
            has_recoverable_text: wordsRecovered > 0,
            audit_type: String((analysis.audit as any)?.likely_type || "unknown"),
            metadata_present: !!(
              (analysis.metadata as any)?.document_info &&
              Object.keys((analysis.metadata as any).document_info).length > 0
            ),
            unredacted_generated: !!analysis.unredactedPath,
            email_count: uniqueEmails.length,
            emails_preview: uniqueEmails.slice(0, 5),
            email_domains: summarizeEmailDomains(uniqueEmails, 5),
            has_emails: uniqueEmails.length > 0,
            is_hit: false,
          };
          result.is_hit = result.has_vulnerabilities || result.has_recoverable_text || result.has_emails;
        } catch (error) {
          if (error instanceof DoiBatchCancelledError) {
            throw error;
          }
          result = {
            filename: pathMod.basename(new URL(sourceUrl).pathname) || "unknown.pdf",
            path: "",
            source_url: sourceUrl,
            success: false,
            error: String(error),
            is_hit: false,
            has_vulnerabilities: false,
            has_recoverable_text: false,
            metadata_present: false,
            unredacted_generated: false,
            email_count: 0,
            emails_preview: [],
            email_domains: [],
            has_emails: false,
            pages: 0,
            audit_type: "unknown",
          };
        }

        processed += 1;
        if (result.success) successful += 1;
        else failed += 1;

        if (onProgress) {
          onProgress({
            discovered: discoveredUrls.length,
            total: urls.length,
            processed,
            successful,
            failed,
            currentUrl: sourceUrl,
            phase: "processing",
          });
        }

        return result;
      })
    )
  );

  const filtered = applyDojFilter(allResults, filter);
  return {
    results: filtered.sort((a, b) => {
      if (a.is_hit !== b.is_hit) return a.is_hit ? -1 : 1;
      if (a.has_vulnerabilities !== b.has_vulnerabilities) {
        return a.has_vulnerabilities ? -1 : 1;
      }
      return (b.pages || 0) - (a.pages || 0);
    }),
    summary: buildDojSummary(allResults, filtered, urls.length),
    discovered: discoveredUrls.length,
  };
}

type DoiJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type DoiBatchJob = {
  id: string;
  status: DoiJobStatus;
  createdAt: string;
  updatedAt: string;
  params: { filter: BatchFilter; maxFiles?: number };
  progress: DoiJobProgress;
  cancelRequested: boolean;
  result?: DoiBatchPayload;
  error?: string;
};

const DOJ_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const dojBatchJobs = new Map<string, DoiBatchJob>();

function pruneOldDojJobs(): void {
  const now = Date.now();
  for (const [id, job] of dojBatchJobs.entries()) {
    const updatedAt = new Date(job.updatedAt).getTime();
    if (now - updatedAt > DOJ_JOB_TTL_MS) {
      dojBatchJobs.delete(id);
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Redirect legacy fly.dev hostname to custom domain
  app.use((req, res, next) => {
    if (req.hostname === 'epstein-file-explorer.fly.dev') {
      return res.redirect(301, `https://epstein-file-explorer.com${req.originalUrl}`);
    }
    next();
  });

  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getStats();
      res.set('Cache-Control', 'public, max-age=300');
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  /**
   * GET /api/persons
   * Without ?page: returns Person[] (full array)
   * With ?page=N&limit=M: returns { data: Person[], total, page, totalPages }
   */
  app.get("/api/persons", async (req, res) => {
    try {
      const pageParam = req.query.page as string | undefined;
      const limitParam = req.query.limit as string | undefined;

      if (pageParam) {
        const page = Math.max(1, parseInt(pageParam) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(limitParam || "50") || 50));
        const result = await storage.getPersonsPaginated(page, limit);
        res.set('Cache-Control', 'public, max-age=300');
        return res.json(result);
      }

      const persons = await storage.getPersons();
      res.set('Cache-Control', 'public, max-age=300');
      res.json(persons);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch persons" });
    }
  });

  app.get("/api/persons/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const person = await storage.getPersonWithDetails(id);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }
      res.set('Cache-Control', 'public, max-age=300');
      res.json(person);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch person" });
    }
  });

  /**
   * GET /api/documents
   * Always paginates. Supports server-side filtering via query params.
   * Returns { data: Document[], total, page, totalPages }
   */
  app.get("/api/documents", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || "50") || 50));
      const search = (req.query.search as string) || undefined;
      const type = (req.query.type as string) || undefined;
      const dataSet = (req.query.dataSet as string) || undefined;
      const redacted = (req.query.redacted as string) || undefined;
      const mediaType = (req.query.mediaType as string) || undefined;

      const result = await storage.getDocumentsFiltered({ page, limit, search, type, dataSet, redacted, mediaType });
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ ...result, data: result.data.map(omitInternal) });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.get("/api/documents/filters", async (_req, res) => {
    try {
      const filters = await storage.getDocumentFilters();
      res.set('Cache-Control', 'public, max-age=600');
      res.json(filters);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch document filters" });
    }
  });

  app.get("/api/sidebar-counts", async (_req, res) => {
    try {
      const counts = await storage.getSidebarCounts();
      res.set('Cache-Control', 'public, max-age=300');
      res.json(counts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sidebar counts" });
    }
  });

  app.get("/api/documents/:id/adjacent", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const adjacent = await storage.getAdjacentDocumentIds(id);
      res.set('Cache-Control', 'public, max-age=600');
      res.json(adjacent);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch adjacent documents" });
    }
  });

  app.get("/api/documents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const doc = await storage.getDocumentWithDetails(id);
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.set('Cache-Control', 'public, max-age=300');
      res.json(omitInternal(doc));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch document" });
    }
  });

  // Return a presigned R2 URL for direct browser access (iframe, img, video tags)
  app.get("/api/documents/:id/content-url", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const doc = await storage.getDocument(id);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (!doc.r2Key || !isR2Configured()) return res.status(404).json({ error: "No R2 content available" });
      const url = await getPresignedUrl(doc.r2Key);
      res.set("Cache-Control", "private, max-age=3000");
      res.json({ url });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate content URL" });
    }
  });

  // Proxy PDF content to avoid CORS issues with DOJ source URLs
  app.get("/api/documents/:id/pdf", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const doc = await storage.getDocumentWithDetails(id);
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }
      // Stream from R2 through the server (avoids CORS issues with presigned URL redirects)
      if (doc.r2Key && isR2Configured()) {
        try {
          const r2 = await getR2Stream(doc.r2Key);
          res.setHeader("Content-Type", r2.contentType || "application/pdf");
          if (r2.contentLength) res.setHeader("Content-Length", r2.contentLength);
          res.setHeader("Cache-Control", "public, max-age=3600");
          r2.body.pipe(res);
          return;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`R2 stream failed for doc ${id}, falling through: ${msg}`);
        }
      }

      // Try local file
      if (doc.localPath) {
        const absPath = pathMod.resolve(doc.localPath);
        const downloadsDir = pathMod.resolve("data/downloads") + pathMod.sep;
        if (absPath.startsWith(downloadsDir) && fsSync.existsSync(absPath)) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Cache-Control", "private, max-age=3600");
          const stream = fsSync.createReadStream(absPath);
          stream.on("error", () => {
            if (!res.headersSent) res.status(500).json({ error: "File read error" });
          });
          stream.pipe(res);
          return;
        }
      }

      if (!doc.sourceUrl) {
        return res.status(404).json({ error: "No source URL for this document" });
      }

      if (!isAllowedPdfUrl(doc.sourceUrl)) {
        return res.status(403).json({ error: "Source URL domain not allowed" });
      }

      if (activeProxyStreams >= MAX_PROXY_STREAMS) {
        res.setHeader("Retry-After", "5");
        return res.status(503).json({ error: "Too many proxy requests, try again shortly" });
      }
      activeProxyStreams++;
      res.on("close", () => { activeProxyStreams--; });

      req.setTimeout(60_000, () => {
        if (!res.headersSent) res.status(504).json({ error: "Proxy request timed out" });
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);

      try {
        const response = await fetch(doc.sourceUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          return res.status(502).json({ error: "Failed to fetch PDF from source" });
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
          return res.status(502).json({ error: "Source did not return a PDF" });
        }

        const contentLength = response.headers.get("content-length");
        const MAX_SIZE = 50 * 1024 * 1024; // 50MB
        if (contentLength && parseInt(contentLength) > MAX_SIZE) {
          return res.status(413).json({ error: "PDF exceeds maximum size limit" });
        }

        res.setHeader("Content-Type", "application/pdf");
        if (contentLength) {
          res.setHeader("Content-Length", contentLength);
        }
        res.setHeader("Cache-Control", "public, max-age=86400");

        if (response.body) {
          Readable.fromWeb(response.body as any).pipe(res);
        } else {
          const arrayBuffer = await response.arrayBuffer();
          res.send(Buffer.from(arrayBuffer));
        }
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") {
          return res.status(504).json({ error: "PDF fetch timed out" });
        }
        throw err;
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to proxy PDF" });
    }
  });

  // Serve document images (photos from data sets)
  app.get("/api/documents/:id/image", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const doc = await storage.getDocumentWithDetails(id);
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Redirect to R2 presigned URL
      if (doc.r2Key && isR2Configured()) {
        try {
          const url = await getPresignedUrl(doc.r2Key);
          return res.redirect(url);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`R2 presigned URL failed for image doc ${id}: ${msg}`);
        }
      }

      // Try local file
      if (doc.localPath) {
        const absPath = pathMod.resolve(doc.localPath);
        const downloadsDir = pathMod.resolve("data/downloads") + pathMod.sep;
        if (absPath.startsWith(downloadsDir) && fsSync.existsSync(absPath)) {
          const ext = pathMod.extname(absPath).toLowerCase();
          const mimeMap: Record<string, string> = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".gif": "image/gif",
            ".webp": "image/webp", ".bmp": "image/bmp",
          };
          res.setHeader("Content-Type", mimeMap[ext] || "image/jpeg");
          res.setHeader("Cache-Control", "private, max-age=3600");
          const stream = fsSync.createReadStream(absPath);
          stream.on("error", () => {
            if (!res.headersSent) res.status(500).json({ error: "File read error" });
          });
          stream.pipe(res);
          return;
        }
      }

      // Fallback: proxy from source URL
      if (doc.sourceUrl && isAllowedPdfUrl(doc.sourceUrl)) {
        if (activeProxyStreams >= MAX_PROXY_STREAMS) {
          res.setHeader("Retry-After", "5");
          return res.status(503).json({ error: "Too many proxy requests, try again shortly" });
        }
        activeProxyStreams++;
        res.on("close", () => { activeProxyStreams--; });

        req.setTimeout(60_000, () => {
          if (!res.headersSent) res.status(504).json({ error: "Proxy request timed out" });
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(doc.sourceUrl, { signal: controller.signal });
          clearTimeout(timeout);
          if (!response.ok) {
            return res.status(502).json({ error: "Failed to fetch image from source" });
          }
          const contentType = response.headers.get("content-type") || "image/jpeg";
          const contentLength = response.headers.get("content-length");
          res.setHeader("Content-Type", contentType);
          if (contentLength) res.setHeader("Content-Length", contentLength);
          res.setHeader("Cache-Control", "public, max-age=86400");
          if (response.body) {
            Readable.fromWeb(response.body as any).pipe(res);
          } else {
            const arrayBuffer = await response.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
          }
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return res.status(504).json({ error: "Image fetch timed out" });
          }
          throw err;
        }
      } else {
        res.status(404).json({ error: "No image source available" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to serve image" });
    }
  });

  // Proxy video content
  app.get("/api/documents/:id/video", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const doc = await storage.getDocumentWithDetails(id);
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Redirect to R2 presigned URL (browser handles Range requests directly against R2)
      if (doc.r2Key && isR2Configured()) {
        try {
          const url = await getPresignedUrl(doc.r2Key);
          return res.redirect(url);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`R2 presigned URL failed for video doc ${id}: ${msg}`);
        }
      }

      // Try local file
      if (doc.localPath) {
        const absPath = pathMod.resolve(doc.localPath);
        const downloadsDir = pathMod.resolve("data/downloads") + pathMod.sep;
        if (absPath.startsWith(downloadsDir) && fsSync.existsSync(absPath)) {
          const ext = pathMod.extname(absPath).toLowerCase();
          const mimeMap: Record<string, string> = {
            ".mp4": "video/mp4", ".avi": "video/x-msvideo",
            ".mov": "video/quicktime", ".wmv": "video/x-ms-wmv",
            ".webm": "video/webm",
          };
          const stat = fsSync.statSync(absPath);
          const fileSize = stat.size;
          res.setHeader("Content-Type", mimeMap[ext] || "video/mp4");
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Cache-Control", "private, max-age=3600");

          if (req.headers.range) {
            const parts = req.headers.range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            if (start >= fileSize || end >= fileSize || start > end) {
              res.setHeader("Content-Range", `bytes */${fileSize}`);
              return res.status(416).end();
            }
            res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
            res.setHeader("Content-Length", String(end - start + 1));
            res.status(206);
            const stream = fsSync.createReadStream(absPath, { start, end });
            stream.on("error", () => {
              if (!res.headersSent) res.status(500).json({ error: "File read error" });
            });
            stream.pipe(res);
          } else {
            res.setHeader("Content-Length", String(fileSize));
            const stream = fsSync.createReadStream(absPath);
            stream.on("error", () => {
              if (!res.headersSent) res.status(500).json({ error: "File read error" });
            });
            stream.pipe(res);
          }
          return;
        }
      }

      // Fallback: proxy from source URL
      if (doc.sourceUrl && isAllowedPdfUrl(doc.sourceUrl)) {
        if (activeProxyStreams >= MAX_PROXY_STREAMS) {
          res.setHeader("Retry-After", "5");
          return res.status(503).json({ error: "Too many proxy requests, try again shortly" });
        }
        activeProxyStreams++;
        res.on("close", () => { activeProxyStreams--; });

        req.setTimeout(60_000, () => {
          if (!res.headersSent) res.status(504).json({ error: "Proxy request timed out" });
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        try {
          const fetchHeaders: Record<string, string> = {};
          if (req.headers.range) fetchHeaders["Range"] = req.headers.range;
          const response = await fetch(doc.sourceUrl, { signal: controller.signal, headers: fetchHeaders });
          clearTimeout(timeout);
          if (!response.ok && response.status !== 206) {
            return res.status(502).json({ error: "Failed to fetch video from source" });
          }
          const contentType = response.headers.get("content-type") || "video/mp4";
          const contentLength = response.headers.get("content-length");
          const contentRange = response.headers.get("content-range");
          res.setHeader("Content-Type", contentType);
          res.setHeader("Accept-Ranges", "bytes");
          if (contentLength) res.setHeader("Content-Length", contentLength);
          if (contentRange) res.setHeader("Content-Range", contentRange);
          res.setHeader("Cache-Control", "public, max-age=86400");
          if (response.status === 206) res.status(206);
          if (response.body) {
            Readable.fromWeb(response.body as any).pipe(res);
          } else {
            const arrayBuffer = await response.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
          }
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return res.status(504).json({ error: "Video fetch timed out" });
          }
          throw err;
        }
      } else {
        res.status(404).json({ error: "No video source available" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to serve video" });
    }
  });

  app.get("/api/timeline", async (_req, res) => {
    try {
      const events = await storage.getTimelineEvents();
      res.set('Cache-Control', 'public, max-age=300');
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch timeline events" });
    }
  });

  app.get("/api/network", async (_req, res) => {
    try {
      const data = await storage.getNetworkData();
      res.set('Cache-Control', 'public, max-age=300');
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch network data" });
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const query = (req.query.q as string) || "";
      if (query.length < 2) {
        return res.json({ persons: [], documents: [], events: [] });
      }
      const results = await storage.search(query);
      res.set('Cache-Control', 'public, max-age=60');
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to search" });
    }
  });

  app.get("/api/search/pages", async (req, res) => {
    try {
      const query = (req.query.q as string) || "";
      if (query.length < 2) {
        return res.json({ results: [], total: 0, page: 1, totalPages: 0 });
      }
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const results = await storage.searchPages(query, page, limit);
      res.set('Cache-Control', 'public, max-age=60');
      res.json(results);
    } catch (error: any) {
      console.error("search/pages error:", error);
      res.status(500).json({ error: "Failed to search pages" });
    }
  });

  app.get("/api/pipeline/jobs", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const jobs = await storage.getPipelineJobs(status);
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pipeline jobs" });
    }
  });

  app.get("/api/pipeline/stats", async (_req, res) => {
    try {
      const stats = await storage.getPipelineStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pipeline stats" });
    }
  });

  app.get("/api/budget", async (_req, res) => {
    try {
      const summary = await storage.getBudgetSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch budget summary" });
    }
  });

  // AI Analysis routes
  app.get("/api/ai-analyses/aggregate", async (_req, res) => {
    try {
      const aggregate = await storage.getAIAnalysisAggregate();
      res.json(aggregate);
    } catch (error) {
      console.error("GET /api/ai-analyses/aggregate failed:", error);
      res.status(500).json({ error: "Failed to fetch AI analysis aggregate" });
    }
  });

  app.get("/api/ai-analyses", async (req, res) => {
    try {
      const list = await storage.getAIAnalysisList();

      const pageParam = req.query.page as string | undefined;
      const limitParam = req.query.limit as string | undefined;

      if (pageParam) {
        const page = Math.max(1, parseInt(pageParam) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(limitParam || "50") || 50));
        const offset = (page - 1) * limit;
        const paginated = list.slice(offset, offset + limit);
        return res.json({
          analyses: paginated,
          total: list.length,
          page,
          totalPages: Math.ceil(list.length / limit),
        });
      }

      res.json({ analyses: list, total: list.length });
    } catch (error) {
      console.error("GET /api/ai-analyses failed:", error);
      res.status(500).json({ error: "Failed to fetch AI analyses" });
    }
  });

  app.get("/api/ai-analyses/:fileName", async (req, res) => {
    try {
      const { fileName } = req.params;
      if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
        return res.status(400).json({ error: "Invalid file name" });
      }
      const analysis = await storage.getAIAnalysis(fileName);
      if (!analysis) {
        return res.status(404).json({ error: "Analysis not found" });
      }
      res.json(analysis);
    } catch (error) {
      console.error(`GET /api/ai-analyses/${req.params.fileName} failed:`, error);
      res.status(500).json({ error: "Failed to fetch AI analysis" });
    }
  });

  // Bookmark routes
  app.get("/api/bookmarks", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || "anonymous";
      const result = await storage.getBookmarks(userId);
      res.set('Cache-Control', 'private, max-age=60');
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
  });

  app.post("/api/bookmarks", async (req, res) => {
    try {
      const { entityType, entityId, searchQuery, label, userId } = req.body;
      if (!entityType || !["person", "document", "search"].includes(entityType)) {
        return res.status(400).json({ error: "entityType must be 'person', 'document', or 'search'" });
      }

      const parsed = insertBookmarkSchema.parse({
        entityType,
        entityId: entityId ?? null,
        searchQuery: searchQuery ?? null,
        label: label ?? null,
        userId: userId || "anonymous",
      });

      const bookmark = await storage.createBookmark(parsed);
      res.status(201).json(bookmark);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid bookmark data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create bookmark" });
    }
  });

  app.delete("/api/bookmarks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      const deleted = await storage.deleteBookmark(id);
      if (!deleted) {
        return res.status(404).json({ error: "Bookmark not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete bookmark" });
    }
  });

  // Data export routes
  app.get("/api/export/persons", async (req, res) => {

    try {
      const format = (req.query.format as string) || "json";
      const persons = await storage.getPersons();

      if (format === "csv") {
        const headers = ["id", "name", "role", "description", "status", "nationality", "occupation", "category", "documentCount", "connectionCount"];
        const csvRows = [headers.join(",")];
        for (const p of persons) {
          csvRows.push(toCsvRow(headers, p as unknown as Record<string, unknown>));
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=persons.csv");
        return res.send(csvRows.join("\n"));
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=persons.json");
      res.json(persons);
    } catch (error) {
      res.status(500).json({ error: "Failed to export persons" });
    }
  });

  app.get("/api/export/documents", async (req, res) => {

    try {
      const format = (req.query.format as string) || "json";
      const documents = await storage.getDocuments();

      if (format === "csv") {
        const headers = ["id", "title", "documentType", "dataSet", "datePublished", "dateOriginal", "pageCount", "isRedacted", "processingStatus", "aiAnalysisStatus"];
        const csvRows = [headers.join(",")];
        for (const d of documents) {
          csvRows.push(toCsvRow(headers, d as unknown as Record<string, unknown>));
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=documents.csv");
        return res.send(csvRows.join("\n"));
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=documents.json");
      res.json(documents);
    } catch (error) {
      res.status(500).json({ error: "Failed to export documents" });
    }
  });

  app.get("/api/export/search", async (req, res) => {

    try {
      const query = (req.query.q as string) || "";
      const format = (req.query.format as string) || "json";

      if (query.length < 2) {
        return res.status(400).json({ error: "Query must be at least 2 characters" });
      }

      const results = await storage.search(query);

      res.setHeader("Content-Type", format === "csv" ? "text/csv" : "application/json");
      res.setHeader("Content-Disposition", `attachment; filename=search-results.${format === "csv" ? "csv" : "json"}`);

      if (format === "csv") {
        const headers = ["type", "id", "name_or_title", "description"];
        const rows = [headers.join(",")];
        for (const p of results.persons) {
          rows.push(toCsvRow(headers, { type: "person", id: p.id, name_or_title: p.name, description: p.description }));
        }
        for (const d of results.documents) {
          rows.push(toCsvRow(headers, { type: "document", id: d.id, name_or_title: d.title, description: d.description }));
        }
        for (const e of results.events) {
          rows.push(toCsvRow(headers, { type: "event", id: e.id, name_or_title: e.title, description: e.description }));
        }
        return res.send(rows.join("\n"));
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to export search results" });
    }
  });

  // Python tools routes (PDF analysis)
  const pytoolsBridge = (await import("./python-tools.js")).default;

  /**
   * Browse PDF files in a directory
   * GET /api/tools/browse?dir=/path/to/directory
   */
  app.get("/api/tools/browse", apiKeyMiddleware, (req, res) => {
    try {
      const dir = (req.query.dir as string) || pathMod.join(process.cwd(), "data");
      
      // Validate path to prevent directory traversal
      const validation = validatePath(dir);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error });
      }

      const resolvedDir = validation.resolvedPath!;
      if (!fsSync.existsSync(resolvedDir)) {
        return res.status(404).json({ error: "Directory not found" });
      }

      const entries = fsSync.readdirSync(resolvedDir, { withFileTypes: true });
      const items = entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: pathMod.join(resolvedDir, entry.name),
        size: entry.isDirectory() ? null : fsSync.statSync(pathMod.join(resolvedDir, entry.name)).size,
      }));

      res.json({
        success: true,
        currentDir: resolvedDir,
        items: items.sort((a, b) => {
          // Directories first, then by name
          if (a.isDirectory !== b.isDirectory) return b.isDirectory ? 1 : -1;
          return a.name.localeCompare(b.name);
        }),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to browse directory", message: (error as Error).message });
    }
  });

  /**
   * Upload PDF file from user's system
   * POST /api/tools/upload (multipart/form-data)
   */
  app.post("/api/tools/upload", apiKeyMiddleware, (req, res) => {
    try {
      const file = (req as any).files?.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const uploadDir = pathMod.join(os.tmpdir(), "epstein-pdf-analysis");
      if (!fsSync.existsSync(uploadDir)) {
        fsSync.mkdirSync(uploadDir, { recursive: true });
      }

      const filename = `${Date.now()}-${file.name}`;
      const filepath = pathMod.join(uploadDir, filename);
      
      file.mv(filepath, (err: any) => {
        if (err) {
          return res.status(500).json({ error: "Failed to save file", message: err.message });
        }

        res.json({
          success: true,
          path: filepath,
          filename: file.name,
          size: file.size,
        });
      });
    } catch (error) {
      res.status(500).json({ error: "Upload failed", message: (error as Error).message });
    }
  });

  /**
   * Download PDF from URL
   * POST /api/tools/download
   * Body: { url: "https://..." }
   */
  app.post("/api/tools/download", apiKeyMiddleware, async (req, res) => {
    try {
      const { url } = req.body;

      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'url' in request body" });
      }

      // Validate URL is HTTPS or HTTP
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return res.status(400).json({ error: "URL must start with http:// or https://" });
      }

      // SSRF protection: only allow downloads from whitelisted domains
      if (!isAllowedPdfUrl(url)) {
        return res.status(403).json({ error: "URL domain not allowed" });
      }

      // Download the file
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(400).json({ error: `Failed to download: ${response.statusText}` });
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
        return res.status(400).json({ error: "URL does not return a PDF file" });
      }

      const downloadDir = pathMod.join(os.tmpdir(), "epstein-pdf-analysis");
      if (!fsSync.existsSync(downloadDir)) {
        fsSync.mkdirSync(downloadDir, { recursive: true });
      }

      // Extract filename from URL or create one
      const urlPath = new URL(url).pathname;
      const originalName = pathMod.basename(urlPath) || "document.pdf";
      const filename = `${Date.now()}-${originalName}`;
      const filepath = pathMod.join(downloadDir, filename);

      const buffer = await response.buffer();
      fsSync.writeFileSync(filepath, buffer);

      res.json({
        success: true,
        path: filepath,
        filename: originalName,
        size: buffer.length,
        url: url,
      });
    } catch (error) {
      res.status(500).json({ error: "Download failed", message: (error as Error).message });
    }
  });

  /**
   * Test endpoint for debugging
   */
  app.get("/api/tools/test", (req, res) => {
    res.json({ 
      status: "ok",
      testResponse: "This is valid JSON"
    });
  });

  /**
   * Health check for Python tools integration
   */
  app.get("/api/tools/health", (_req, res) => {
    const status = pytoolsBridge.verifyPythonToolsSetup();
    res.status(status.ready ? 200 : 503).json(status);
  });

  /**
   * Run redaction audit on a PDF
   * POST /api/tools/audit-redaction?path=/path/to/file.pdf
   */
  app.post("/api/tools/audit-redaction", apiKeyMiddleware, apiKeyMiddleware, async (req, res) => {
    try {
      const pdfPath = req.query.path as string;

      if (!pdfPath) {
        return res.status(400).json({ error: "Missing 'path' query parameter" });
      }

      // Validate path to prevent directory traversal and command injection
      const validation = validatePath(pdfPath);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error });
      }

      const resolvedPath = validation.resolvedPath!;
      if (!fsSync.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "PDF file not found" });
      }

      const result = await pytoolsBridge.runRedactionAudit(resolvedPath);
      if (!result.success) {
        return res.status(500).json({ error: result.error, stderr: result.stderr });
      }

      res.json({
        success: true,
        path: resolvedPath,
        audit: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to audit redaction" });
    }
  });

  /**
   * Detect bad redactions in a PDF using x-ray
   * POST /api/tools/xray?path=/path/to/file.pdf
   */
  app.post("/api/tools/xray", apiKeyMiddleware, apiKeyMiddleware, async (req, res) => {
    try {
      const pdfPath = req.query.path as string;

      if (!pdfPath) {
        return res.status(400).json({ error: "Missing 'path' query parameter" });
      }

      // Validate path to prevent directory traversal and command injection
      const validation = validatePath(pdfPath);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error });
      }

      const resolvedPath = validation.resolvedPath!;
      if (!fsSync.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "PDF file not found" });
      }

      const result = await pytoolsBridge.runXrayAnalysis(resolvedPath);
      if (!result.success) {
        return res.status(500).json({ error: result.error, stderr: result.stderr });
      }

      res.json({
        success: true,
        path: pdfPath,
        analysis: result.data,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze with x-ray" });
    }
  });

  /**
   * Extract text from poorly-redacted PDFs
   * POST /api/tools/extract-text?path=/path/to/file.pdf&output=/path/to/output.json
   */
  app.post("/api/tools/extract-text", async (req, res) => {
    try {
      const pdfPath = req.query.path as string;
      const outputPath = req.query.output as string | undefined;

      if (!pdfPath) {
        return res.status(400).json({ error: "Missing 'path' query parameter" });
      }

      if (!fsSync.existsSync(pdfPath)) {
        return res.status(404).json({ error: "PDF file not found" });
      }

      const result = await pytoolsBridge.runTextExtraction(pdfPath, outputPath);
      if (!result.success) {
        return res.status(500).json({ error: result.error, stderr: result.stderr });
      }

      res.json({
        success: true,
        path: pdfPath,
        outputPath: result.outputPath,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to extract text" });
    }
  });

  /**
   * Comprehensive PDF analysis (audit + xray + optional extraction)
   * POST /api/tools/analyze?path=/path/to/file.pdf&extract=true&output=/path/to/output.json
   */
  app.post("/api/tools/analyze", apiKeyMiddleware, async (req, res) => {
    try {
      const pdfPath = req.query.path as string;
      const extract = req.query.extract === "true";
      const outputPath = req.query.output as string | undefined;

      if (!pdfPath) {
        return res.status(400).json({ error: "Missing 'path' query parameter" });
      }

      if (!fsSync.existsSync(pdfPath)) {
        return res.status(404).json({ error: "PDF file not found" });
      }

      console.log(`[PDF Analysis] Starting analysis of: ${pathMod.basename(pdfPath)}`);
      const result = await pytoolsBridge.analyzePDF(pdfPath, {
        extract,
        extractOutputPath: outputPath,
      });
      
      console.log(`[PDF Analysis] Analysis complete, returning summary.`);
      res.json(result);
    } catch (error) {
      console.error("[PDF Analysis] Error analyzing PDF:", error);
      res.status(500).json({ 
        error: "Failed to analyze PDF",
        details: (error as Error).message,
      });
    }
  });

  /**
   * Download unredacted PDF file
   * GET /api/tools/download-unredacted?path=/path/to/unredacted.pdf
   */
  app.get("/api/tools/download-unredacted", (req, res) => {
    try {
      const filePath = req.query.path as string;

      if (!filePath) {
        return res.status(400).json({ error: "Missing 'path' query parameter" });
      }

      if (!fsSync.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const fileName = pathMod.basename(filePath);
      res.download(filePath, fileName, (err) => {
        if (err) {
          console.error("[Download] Error downloading file:", err);
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Download failed" });
    }
  });

  /**
   * Download extracted text JSON file
   * GET /api/tools/download-extracted?path=/path/to/extracted.json
   */
  app.get("/api/tools/download-extracted", apiKeyMiddleware, (req, res) => {
    try {
      const filePath = req.query.path as string;

      if (!filePath) {
        return res.status(400).json({ error: "Missing 'path' query parameter" });
      }

      // Validate path to prevent directory traversal
      const validation = validatePath(filePath);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error });
      }

      const resolvedPath = validation.resolvedPath!;
      if (!fsSync.existsSync(resolvedPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = fsSync.readFileSync(resolvedPath, "utf-8");
      res.setHeader("Content-Type", "application/json");
      res.send(content);
    } catch (error) {
      res.status(500).json({ error: "Failed to retrieve extracted text" });
    }
  });

  /**
   * Batch audit PDFs from directory
   * POST /api/tools/batch-audit
   * Body: { directory: "/path/to/dir", filter: "all|vulnerable|recoverable" }
   * Returns: Array of audit results with "hit" status
   */
  app.post("/api/tools/batch-audit", apiKeyMiddleware, apiKeyMiddleware, async (req, res) => {
    try {
      const { directory, filter = "all" } = req.body;

      if (!directory) {
        return res.status(400).json({ error: "Missing 'directory' parameter" });
      }

      // Validate path to prevent directory traversal
      const validation = validatePath(directory);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error });
      }

      const resolvedDir = validation.resolvedPath!;
      if (!fsSync.existsSync(resolvedDir)) {
        return res.status(400).json({ error: "Directory not found" });
      }

      // Get all PDFs in directory
      const files = fsSync
        .readdirSync(resolvedDir)
        .filter((f) => f.toLowerCase().endsWith(".pdf"))
        .map((f) => pathMod.join(resolvedDir, f));

      if (files.length === 0) {
        return res.json({ results: [], summary: { total: 0, hits: 0 } });
      }

      // Analyze files in parallel (batch of 3 at a time to avoid overload)
      const results = [];
      const batchSize = 3;

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (filePath) => {
            try {
              const analysis = await pytoolsBridge.analyzePDF(filePath);

              const hit = {
                filename: pathMod.basename(filePath),
                path: filePath,
                success: analysis.success,
                pages: analysis.audit?.pages || 0,
                // Detect "hits" - files with vulnerable redactions or recoverable text
                has_vulnerabilities: analysis.xray && Object.keys(analysis.xray).length > 0,
                has_recoverable_text: analysis.extractedText && Object.keys(analysis.extractedText).length > 0,
                audit_type: analysis.audit?.likely_type || "unknown",
                metadata_present: analysis.metadata?.document_info && Object.keys(analysis.metadata.document_info).length > 0,
                unredacted_generated: !!analysis.unredactedPath,
              };

              // Determine if this is a "hit"
              hit.is_hit =
                hit.has_vulnerabilities ||
                (hit.unredacted_generated &&
                  analysis.unredactionStats?.recovery_rate &&
                  analysis.unredactionStats.recovery_rate > 0);

              return hit;
            } catch (e) {
              return {
                filename: pathMod.basename(filePath),
                path: filePath,
                success: false,
                error: String(e),
                is_hit: false,
              };
            }
          })
        );

        results.push(...batchResults);
      }

      // Filter results based on filter parameter
      let filtered = results;
      if (filter === "vulnerable") {
        filtered = results.filter((r) => r.has_vulnerabilities);
      } else if (filter === "recoverable") {
        filtered = results.filter((r) => r.has_recoverable_text);
      } else if (filter === "hits") {
        filtered = results.filter((r) => r.is_hit);
      }

      // Generate summary
      const summary = {
        total: files.length,
        analyzed: results.filter((r) => r.success).length,
        hits: filtered.filter((r) => r.is_hit).length,
        vulnerable: filtered.filter((r) => r.has_vulnerabilities).length,
        recoverable: filtered.filter((r) => r.has_recoverable_text).length,
        with_metadata: filtered.filter((r) => r.metadata_present).length,
      };

      res.json({
        results: filtered.sort((a, b) => {
          // Sort: hits first, then by vulnerabilities, then by page count
          if (a.is_hit !== b.is_hit) return a.is_hit ? -1 : 1;
          if (a.has_vulnerabilities !== b.has_vulnerabilities)
            return a.has_vulnerabilities ? -1 : 1;
          return (b.pages || 0) - (a.pages || 0);
        }),
        summary,
      });
    } catch (error) {
      res.status(500).json({ error: `Batch audit failed: ${String(error)}` });
    }
  });

  /**
   * Email artifact audit over AI-analyzed JSON corpus.
   * POST /api/tools/email-audit-ai
   * Body: { maxFiles?: number }
   */
  app.post("/api/tools/email-audit-ai", apiKeyMiddleware, (req, res) => {
    try {
      const { maxFiles } = req.body ?? {};
      const payload = runAiAnalyzedEmailAudit(maxFiles);
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: `Email audit failed: ${String(error)}` });
    }
  });

  /**
   * Batch audit PDFs directly from DOJ disclosures (auto-discovery + download + analysis)
   * POST /api/tools/batch-audit-doj
   * Body: { filter?: "all|hits|vulnerable|recoverable", maxFiles?: number }
   */
  app.post("/api/tools/batch-audit-doj", apiKeyMiddleware, async (req, res) => {
    try {
      const { filter = "all", maxFiles } = req.body ?? {};
      const payload = await performDojBatchAudit({
        filter,
        maxFiles,
      });
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: `DOJ batch audit failed: ${String(error)}` });
    }
  });

  /**
   * Create a long-running DOJ batch-audit job.
   * POST /api/tools/batch-audit-doj/jobs
   * Body: { filter?: "all|hits|vulnerable|recoverable", maxFiles?: number }
   */
  app.post("/api/tools/batch-audit-doj/jobs", apiKeyMiddleware, async (req, res) => {
    try {
      pruneOldDojJobs();
      const { filter = "all", maxFiles } = req.body ?? {};
      const jobId = createHash("sha1")
        .update(`${Date.now()}-${Math.random()}-${filter}-${String(maxFiles ?? "")}`)
        .digest("hex")
        .slice(0, 16);

      const job: DoiBatchJob = {
        id: jobId,
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        params: {
          filter,
          maxFiles: Number.isFinite(Number(maxFiles)) ? Number(maxFiles) : undefined,
        },
        progress: {
          discovered: 0,
          total: 0,
          processed: 0,
          successful: 0,
          failed: 0,
        },
        cancelRequested: false,
      };

      dojBatchJobs.set(jobId, job);

      setImmediate(async () => {
        const current = dojBatchJobs.get(jobId);
        if (!current) return;
        if (current.cancelRequested) {
          current.status = "cancelled";
          current.error = "DOJ batch audit cancelled by user";
          current.updatedAt = new Date().toISOString();
          return;
        }
        current.status = "running";
        current.updatedAt = new Date().toISOString();

        try {
          const result = await performDojBatchAudit(
            { filter: current.params.filter, maxFiles: current.params.maxFiles },
            (progress) => {
              const target = dojBatchJobs.get(jobId);
              if (!target) return;
              target.progress = progress;
              target.updatedAt = new Date().toISOString();
            },
            () => {
              const target = dojBatchJobs.get(jobId);
              return !!target?.cancelRequested;
            },
          );
          const target = dojBatchJobs.get(jobId);
          if (!target) return;
          if (target.cancelRequested) {
            target.status = "cancelled";
            target.error = "DOJ batch audit cancelled by user";
            target.updatedAt = new Date().toISOString();
            return;
          }
          target.result = result;
          target.status = "completed";
          target.updatedAt = new Date().toISOString();
        } catch (error) {
          const target = dojBatchJobs.get(jobId);
          if (!target) return;
          if (error instanceof DoiBatchCancelledError || target.cancelRequested) {
            target.error = "DOJ batch audit cancelled by user";
            target.status = "cancelled";
          } else {
            target.error = String(error);
            target.status = "failed";
          }
          target.updatedAt = new Date().toISOString();
        }
      });

      return res.status(202).json({
        jobId,
        status: "queued",
        pollUrl: `/api/tools/batch-audit-doj/jobs/${jobId}`,
      });
    } catch (error) {
      res.status(500).json({ error: `Failed to create DOJ batch audit job: ${String(error)}` });
    }
  });

  /**
   * Cancel a DOJ batch-audit job.
   * POST /api/tools/batch-audit-doj/jobs/:jobId/cancel
   */
  app.post("/api/tools/batch-audit-doj/jobs/:jobId/cancel", apiKeyMiddleware, (req, res) => {
    pruneOldDojJobs();
    const job = dojBatchJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return res.status(409).json({ error: `Cannot cancel a ${job.status} job` });
    }

    job.cancelRequested = true;
    job.updatedAt = new Date().toISOString();
    job.error = "Cancellation requested";

    return res.json({
      jobId: job.id,
      status: job.status,
      cancelRequested: true,
    });
  });

  /**
   * Get status of a DOJ batch-audit job.
   * GET /api/tools/batch-audit-doj/jobs/:jobId
   */
  app.get("/api/tools/batch-audit-doj/jobs/:jobId", apiKeyMiddleware, (req, res) => {
    pruneOldDojJobs();
    const job = dojBatchJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.json({
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      params: job.params,
      progress: job.progress,
      result: job.status === "completed" ? job.result : undefined,
      error: job.status === "failed" || job.status === "cancelled" ? job.error : undefined,
      cancelRequested: job.cancelRequested,
    });
  });

  /**
   * Export batch audit as CSV
   * POST /api/tools/batch-audit-export
   * Body: { results: [...] }
   * Returns: CSV file
   */
  app.post("/api/tools/batch-audit-export", (req, res) => {
    try {
      const { results } = req.body;

      if (!Array.isArray(results)) {
        return res.status(400).json({ error: "Invalid results format" });
      }

      // Build CSV
      const headers = [
        "Filename",
        "Pages",
        "Status",
        "Vulnerabilities",
        "Recoverable Text",
        "Metadata",
        "Emails Found",
        "Email Domains",
        "Unredacted PDF",
        "Path",
      ];

      const rows = results.map((r) => [
        escapeCsvField(r.filename),
        r.pages || 0,
        r.is_hit ? "HIT ⚠️" : "CLEAN",
        r.has_vulnerabilities ? "YES" : "NO",
        r.has_recoverable_text ? "YES" : "NO",
        r.metadata_present ? "YES" : "NO",
        r.email_count || 0,
        escapeCsvField(Array.isArray(r.email_domains) ? r.email_domains.join(" | ") : ""),
        r.unredacted_generated ? "YES" : "NO",
        escapeCsvField(r.path),
      ]);

      const csv =
        [headers.map(escapeCsvField).join(",")].concat(
          rows.map((r) => r.join(","))
        )
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="batch-audit-results.csv"'
      );
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: "Export failed" });
    }
  });

  // Chat routes (Ask the Archive)
  registerChatRoutes(app);

  return httpServer;
}
