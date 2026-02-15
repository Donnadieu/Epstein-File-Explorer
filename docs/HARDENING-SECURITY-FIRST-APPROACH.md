<!-- markdownlint-disable MD013 -->
# Hardening the Epstein File Explorer: A Security-First Approach to Public Record Analysis at Scale

**Authors:** David (WebDUH LLC) with Claude (Anthropic)  
**Date:** February 15, 2026  
**Repository:** [reconsumeralization/Epstein-File-Explorer](https://github.com/reconsumeralization/Epstein-File-Explorer) (fork of Donnadieu/Epstein-File-Explorer)

---

## Abstract

On January 30, 2026, the U.S. Department of Justice released approximately 3.5 million pages of documents, 180,000 images, and 2,000 videos related to the Jeffrey Epstein investigation — one of the largest single disclosures of investigative material in U.S. history. Within days, the DOJ removed bulk download capability, Data Set 9 proved incomplete at the source, redaction failures exposed victim identities, and the sheer scale of the release overwhelmed individual researchers.

The Epstein File Explorer is an open-source pipeline and web application that ingests these files via BitTorrent, extracts text from PDFs, runs AI-powered entity and relationship extraction via DeepSeek, and loads structured data into PostgreSQL for interactive exploration through a React frontend with D3 network graphs, timelines, and full-text search.

This paper documents our systematic hardening of the pipeline — applying security research methodology to a data engineering problem. We identified and patched path traversal vulnerabilities in the torrent downloader, replaced blind trust of LLM output with Zod schema validation, added resource guardrails to prevent OOM on 300GB+ datasets, implemented database transaction safety, built a cost-estimation dry-run mode for AI analysis, created a Data Set 9 gap analysis tool, and researched the eight categories of problems that citizens, journalists, and archivists are encountering with the files online.

The work demonstrates that document transparency infrastructure requires the same rigor as any system handling adversarial input — because torrent metadata, OCR output, and LLM responses are all untrusted data sources.

---

## 1. Background: The Epstein Files Release

### 1.1 The Disclosure

The Epstein Files Transparency Act (H.R. 4405), signed November 19, 2025, required the DOJ to release all unclassified records related to the Epstein and Maxwell investigations. The DOJ identified over 6 million potentially responsive pages from six primary sources: the Florida and New York Epstein cases, the Maxwell prosecution, death investigations, FBI investigations, and the OIG inquiry. The January 30, 2026 release covered approximately 3.5 million pages organized into 12 data sets, with the DOJ claiming compliance with the Act.

### 1.2 The Problems

Our research identified eight distinct categories of issues affecting public access and analysis:

1. **Bulk download removal** — The DOJ removed ZIP download links around February 6, 2026, forcing one-PDF-at-a-time access across millions of pages.

2. **Data Set 9 incompleteness** — The largest and most legally significant dataset (Epstein's emails, NPA correspondence) was never fully downloadable from DOJ servers. Multiple independent users hit the same ~49GB download cutoff of ~180GB total. Community reconstruction efforts have recovered approximately 148GB but gaps remain.

3. **Broken redactions** — Three classes of failure: copy-paste bypass on visual-overlay redactions (affecting incorporated court filings), semi-transparent image redactions readable via brightness adjustment, and inconsistent redaction across duplicate copies of the same document.

4. **Victim name exposure** — The DOJ acknowledged taking down "several thousand documents" that inadvertently exposed victim-identifying information. Attorneys identified approximately 100 survivors whose personal details were made public.

5. **Massive unorganized duplication** — The DOJ "erred on the side of over-collecting," resulting in countless duplicate copies of documents across datasets with different redaction levels applied.

6. **No chronological or logical organization** — Files are grouped by investigative source, not by date, topic, or relevance. No master index exists.

7. **Poor OCR quality** — Source images at 96 DPI with garbled OCR text layers, affecting all downstream text extraction and AI analysis.

8. **Silent file removal and modification** — Documents removed from the DOJ site without notification, dataset listings shrinking between Wayback Machine captures, and no public changelog.

### 1.3 Why This Matters

90% of Americans surveyed want the Epstein files released. Only 6% are satisfied with how the government has handled the disclosure. The gap between "technically released" and "meaningfully accessible" is enormous. Tools like the Epstein File Explorer exist to bridge that gap — but only if the tools themselves are reliable, secure, and correct.

---

## 2. The Upstream Project

The Epstein File Explorer (Donnadieu/Epstein-File-Explorer) is a full-stack TypeScript application providing:

**Frontend:** React 18, Tailwind CSS, shadcn/ui, D3.js force-directed network graphs, Recharts timelines, full-text search with highlighted snippets, document comparison views, and keyboard navigation.

**Backend:** Express 5, Drizzle ORM over PostgreSQL with full-text search indexes, Cloudflare R2 for document storage, WebSocket for real-time updates.

**Pipeline:** A 14-stage ETL pipeline orchestrated by `run-pipeline.ts`:

```text
scrape-wikipedia → download-torrent → upload-r2 → process →
ds9-gap-analysis → classify-media → analyze-ai → load-persons →
load-documents → import-downloads → load-ai-results →
extract-connections → update-counts → dedup-persons → dedup-connections
```

**Data flow:** Wikipedia scraping produces person entities. BitTorrent (via aria2c) downloads DOJ data sets as PDFs. pdfjs-dist extracts text. DeepSeek API performs two-tier analysis (regex pre-scan + LLM structured extraction) to identify persons, connections, events, locations, and document classifications. Results load into PostgreSQL for the web frontend.

**Scale:** 12 data sets totaling 300GB+, 180,000+ files, 5,577 AI-analyzed documents, 200+ tracked persons, 5,400+ timeline events.

The upstream project is well-designed for its purpose. It is not, however, designed by someone who thinks about adversarial input, resource exhaustion, or data integrity verification — because those aren't the concerns of someone building a document explorer. They're the concerns of a security researcher.

---

## 3. What We Did: Security Audit and Hardening

### 3.1 Methodology

We applied vulnerability research methodology to the pipeline codebase:

1. **Threat modeling** — Identified all trust boundaries: torrent metadata (attacker-controlled filenames), OCR output (garbage in), LLM responses (hallucinated structure), PDF content (potential resource bombs), and filesystem operations (path traversal surface).

2. **Code review** — Read every pipeline file (~20 TypeScript files, ~302K total) for: unsafe path construction, unchecked external input, missing error handling, resource exhaustion vectors, and data integrity gaps.

3. **Patch development** — Implemented fixes with zero new dependencies where possible, maintaining backward compatibility and idempotency.

4. **Type verification** — Every patch verified via `tsc --noEmit` with zero new errors.

### 3.2 Sprint 1: Security Patches

### Patch 1: Path Traversal Safety (torrent-downloader.ts)

The torrent downloader takes filenames from torrent metadata — which is attacker-controlled data in the BitTorrent model. A malicious torrent could contain entries like `../../etc/passwd` or `../../../home/user/.ssh/authorized_keys`. The original code used these filenames directly in `fs.rmSync` (recursive deletion) and path construction without validation.

We added:

- `safeResolve(baseDir, candidate)` — resolves a candidate path and rejects it if the result escapes the base directory.
- `safeRmSync(baseDir, target)` — wraps `fs.rmSync` with the same containment check.
- Applied at 7 call sites: both `rmSync` calls (partial extraction cleanup, staging cleanup), archive-entry copy fallback, destination path construction, and the collision-handling rename loop.

This is the same class of vulnerability (CWE-22) that appears repeatedly in supply chain attacks. In a pipeline processing 300GB of torrent-sourced data, it's a real attack surface.

### Patch 2: Zod Validation for LLM Output (ai-analyzer.ts)

The AI analyzer calls DeepSeek's API and receives JSON responses that are immediately trusted and loaded into the database. LLM outputs are not reliable structured data — they hallucinate fields, return partial structures, mix types, and occasionally produce completely malformed JSON.

We added:

- Six Zod schemas: `PersonMentionSchema`, `ConnectionSchema`, `EventSchema`, `AIAnalysisOutputSchema` with `.default()` for graceful degradation.
- `validateAIOutput(raw, fileName, context)` function replacing raw `JSON.parse` trust.
- Quarantine directory (`data/ai-analyzed/invalid/`) for payloads that fail validation, preserving the raw response, validation errors, and timestamps for debugging.
- Invalid chunks are logged and skipped cleanly — no silent acceptance of malformed data.

This is defense-in-depth: the LLM is a data source, not an authority. Every field must conform to a schema before it reaches the database.

### 3.3 Sprint 2: Operational Hardening

### Patch 3: PDF Resource Guardrails (pdf-processor.ts)

The pipeline processes 180,000+ files. Some PDFs in the Epstein files are enormous (hundreds of megabytes of scanned images). Processing them all concurrently on a single machine causes OOM kills.

We added:

- `--max-file-size-mb N` (default 256MB) — oversize files skipped with a warning log.
- `--max-concurrent-pdfs N` (default 4) — extraction runs through `pLimit` concurrency control.
- `--no-skip-oversize` flag to force processing of large files when explicitly desired.
- Extended `ExtractionLog` interface with `totalSkippedOversize` tracking.

### Patch 4: AI Analysis Dry-Run Mode (ai-analyzer.ts)

Running AI analysis on 180,000 documents without knowing the cost is reckless. DeepSeek charges $0.27/M input tokens and $1.10/M output tokens. A full run could cost hundreds of dollars.

We added `--dry-run`:

- Scans all candidate documents, loads text, applies priority/length filters.
- Estimates tokens (~4 chars/token for English) and output tokens (~500/doc for structured JSON).
- Calculates estimated cost against DeepSeek pricing.
- Reports: documents to analyze, skip counts, total chars, estimated tokens, estimated cost.
- Compares against `--budget` if set.
- Returns with zero API calls made.

### Patch 5: Database Transaction Safety (db-loader.ts)

The original DB loading code inserted rows one at a time with no transaction boundaries. A failure mid-load left the database in an inconsistent state — some data loaded, some not — with no way to know where it stopped.

We added:

- `loadPersonsFromFile`: batched transactions (100 rows per tx). Failed batches roll back atomically.
- `loadDocumentsFromCatalog`: per-dataset transactions. Failed datasets don't corrupt successful ones.
- Uses Drizzle's `db.transaction(async (tx) => { ... })` API.
- Failed batches log and continue — safe to re-run without duplicating successful portions.

### Patch 6: Pipeline Orchestrator Wiring (run-pipeline.ts)

Extended `PipelineConfig` with `dryRun`, `maxFileSizeMB`, `maxConcurrentPdfs`, `expectedMaxId`. Wired all new options through the stage dispatch. Updated CLI parser and help text.

### 3.4 Sprint 3: DS9 Gap Analysis

Data Set 9 is the most legally significant and the most broken. We built a standalone gap analysis stage that:

- Scans `data/downloads/data-set-9/` and `data/extracted/ds9/` for existing files.
- Parses EFTA IDs from filenames.
- Computes the observed ID range and identifies gaps.
- Outputs a recovery manifest (`data/ds9-recovery-manifest.json`) listing present IDs and gap ranges.
- Accepts `--expected-max-id N` to compute gap ranges against the known total.
- Runs standalone (no database required) or as a pipeline stage.

This stage is the prerequisite for a targeted DOJ scraper that can attempt to recover individual missing files by EFTA ID.

---

## 4. Comparison: Before and After

### 4.1 Security Posture

| Attack Surface | Before | After |
| --- | --- | --- |
| Path traversal via torrent metadata | No protection. `fs.rmSync` called with unvalidated paths from torrent entries. | `safeResolve` + `safeRmSync` at all 7 call sites. Any path escaping the base directory is rejected. |
| Malformed LLM output | Raw `JSON.parse` → direct DB insertion. Any hallucinated structure accepted silently. | Zod schema validation with 6 typed schemas. Invalid payloads quarantined with full diagnostics. |
| Resource exhaustion (PDF bombs) | No file size limits. No concurrency control. All PDFs processed in serial or unbounded parallel. | 256MB size limit, 4-concurrent-PDF default, `pLimit` enforcement. Oversize files logged and skipped. Streaming read (file URL or streamed buffer) so oversize files are never fully loaded when capped. |

### 4.2 Operational Safety

| Operation | Before | After |
| --- | --- | --- |
| AI cost control | No way to preview costs. Must run analysis and watch the bill. | `--dry-run` scans inputs, estimates tokens and cost against DeepSeek pricing. Budget comparison before spend. |
| Database loading | No transactions. Failure mid-load = inconsistent state. No safe re-run. | Batched transactions (100 rows/tx for persons, per-dataset for documents). Atomic rollback on failure. Safe re-run. |
| DS9 completeness | No visibility into what's missing. | Gap analysis stage outputs a recovery manifest with present IDs and gap ranges. |

### 4.3 Developer Experience

| Area | Before | After |
| --- | --- | --- |
| Environment setup | No `.env.example`. Developers must read code to find required env vars. | `.env.example` with all 10 env vars documented. `setup.bat` (Windows) and `setup.sh` (Unix) scripts. |
| IDE integration | No Cursor configuration. | `.cursor/rules` (AI context), `.cursor/epstein-explorer.code-workspace` (4 launch configs, smart file exclusions), `worktrees.json`. |
| Pipeline CLI | Core stages only. | New flags: `--dry-run`, `--max-file-size-mb`, `--max-concurrent-pdfs`, `--expected-max-id`. New stage: `ds9-gap-analysis`. |

### 4.4 Lines Changed

| Patch Set | Files | Lines Added | Lines Removed | Net |
| --- | --- | --- | --- | --- |
| Sprint 1: Security | 2 | +155 | -0 | +155 |
| Sprint 2: Operational | 4 | +232 | -94 | +138 |
| Sprint 3: DS9 Gap Analysis | 2 | ~200 | -0 | ~200 |
| Worktree Setup | 6 | ~550 | -0 | ~550 |
| **Total** | **14** | **~1,137** | **-94** | **~1,043** |

All changes pass `tsc --noEmit` with zero new type errors. No new runtime dependencies (Zod and p-limit were already in `package.json`).

---

## 5. What Remains

### 5.1 Priority Backlog

| Priority | Task | Purpose |
| --- | --- | --- |
| 1 | DOJ recovery scraper for DS9 gaps | Use the gap manifest to fetch individual missing PDFs from DOJ endpoints |
| 2 | Master index CSV/JSON export | One-line summary + key names + date for every document — the navigational backbone the DOJ didn't provide |
| 3 | Redaction audit stage | Flag documents where extracted text exists beneath visual redaction marks, for responsible reporting to `efta@usdoj.gov` |
| 4 | Document deduplication (SimHash/MinHash) | Reduce the effective corpus from 3.5M pages to actual unique documents |
| 5 | Archive integrity verification | **Implemented:** Optional SHA-256 verification before extraction. Set `expectedSha256` on `TorrentConfig` or use `data/archive-checksums.json` (key = data set ID). Streaming hash via `sha256File()` so safe for 180GB archives. File-count comparison against community manifest still open. |
| 6 | Re-OCR for low-quality extractions | Re-process scanned PDFs through Tesseract 5, improving AI analysis input quality |
| 7 | DOJ diff tracking | Detect silent removals and additions by comparing local archive against live DOJ listings |
| 8 | Email thread reconstruction | Group DS9 email documents by thread headers for readable chronological conversations |

### 5.2 Infrastructure

- Structured logging (replace `console.log` with leveled, parseable output)
- Token-bucket rate limiting (replace fixed delays)
- Startup environment validation (fail fast on missing required vars)
- Unit tests for all hardening patches
- CI pipeline (GitHub Actions: lint, type-check, test on PR)
- Runbooks for common operations

---

## 6. Observations

### 6.1 The Pipeline Is an Attack Surface

Most people think of document explorers as read-only tools. But the pipeline that feeds the explorer processes attacker-controlled input at every stage:

- **Torrent metadata** — filenames come from peers. A malicious seeder could craft entries with path traversal sequences.
- **PDF content** — the DOJ release includes files that were submitted to the FBI by the public, including potentially malicious documents.
- **LLM output** — DeepSeek returns structured JSON that may contain any content, including hallucinated relationships, incorrect entity classifications, or malformed data.
- **OCR text** — garbage OCR produces garbage entities. The pipeline must handle gracefully.

Security research methodology — threat modeling, input validation, defense in depth — applies directly to data engineering on untrusted sources.

### 6.2 Transparency Infrastructure Needs Maintenance

The DOJ's release is not a static archive. Files are being removed, re-redacted, and re-published on an ongoing basis. Dataset listings change between Wayback captures. The bulk download mechanism was removed entirely. Any tool that treats the release as a one-time download will drift from reality.

The pipeline needs continuous verification: checksum comparison, file-count monitoring, and diff tracking against the live DOJ site. The community archive (yung-megafone/Epstein-Files) provides the reference checksums, but the pipeline must actually use them.

### 6.3 The DS9 Problem Is Unsolved

Data Set 9 — containing Epstein's private emails, high-profile correspondence, and internal DOJ communications about the 2008 non-prosecution agreement — remains the most important and most incomplete dataset. The DOJ server cuts off at ~49GB of ~180GB. Community composites have recovered ~148GB from multiple partial downloads, but file-level gap analysis shows documents are still missing.

The gap analysis stage we built is the first step. The next step is a targeted scraper that uses the recovery manifest to fetch individual missing PDFs from DOJ endpoints by EFTA ID. This is the highest-impact remaining work.

### 6.4 Victim Safety Requires Active Engineering

The DOJ's redaction failures are not theoretical. Attorneys identified ~100 survivors whose names were exposed. The pipeline extracts text that may include victim information from documents where redactions were improperly applied. The redaction audit stage we proposed would flag these documents — not to expose the information, but to identify documents that should be reported to the DOJ for correction. This is a case where the tool must be designed with an ethical constraint built into the code, not just the documentation.

---

## 7. Conclusion

The Epstein File Explorer is a well-built document analysis platform. Our contribution is making it safer to operate: securing the input boundaries, adding resource controls, providing cost visibility, ensuring database consistency, and building tooling for the specific problems that the DOJ release has created.

The pattern generalizes. Any pipeline that processes external data at scale — government releases, FOIA responses, leaked datasets, open data portals — faces the same classes of problems: adversarial input, resource exhaustion, data integrity, and ethical handling of sensitive information. The security research methodology we applied here — threat modeling, systematic code review, defense in depth, and validation at trust boundaries — is the right approach for all of them.

The files are public. The tools to understand them should be reliable.

---

## Appendix A: File Inventory

**Pipeline scripts (scripts/pipeline/):**

- `run-pipeline.ts` — Orchestrator + CLI (380 lines)
- `torrent-downloader.ts` — BitTorrent via aria2c (31K)
- `ai-analyzer.ts` — Two-tier analysis: regex + DeepSeek (32K)
- `db-loader.ts` — All DB loading with batched transactions (71K)
- `pdf-processor.ts` — pdfjs-dist extraction with guardrails (11K)
- `ds9-gap-analysis.ts` — DS9 gap analysis + recovery manifest (new)
- `doj-scraper.ts` — DOJ website scraper (31K)
- `document-downloader.ts` — Direct HTTP downloader (18K)
- `wikipedia-scraper.ts` — Wikipedia person scraper (14K)
- `media-classifier.ts` — Document type classifier (12K)
- `batch-processor.ts` — Generic batch processing utilities (22K)
- `generate-profiles.ts` — AI profile generation (11K)
- `r2-migration.ts` — R2 upload migration (6K)
- `r2-backfill.ts` — R2 backfill utility (3K)
- `classify-from-pages.ts` — Page-level classification (13K)
- `load-pages.ts` — Page loading utility (4K)
- `analyze-wiki.ts` — Wikipedia analysis (2.5K)
- `test-ai.ts` / `test-pdf.ts` — Test utilities
- `setup-fts.sql` — Full-text search setup

**Our additions/modifications:**

- `torrent-downloader.ts` — +46 lines (safeResolve, safeRmSync, 7 call sites)
- `ai-analyzer.ts` — +165 lines (6 Zod schemas, validateAIOutput, quarantine, dry-run)
- `pdf-processor.ts` — +120 lines (size limits, pLimit concurrency, CLI flags)
- `db-loader.ts` — +135 lines (batched transactions for persons + documents)
- `run-pipeline.ts` — +30 lines (new config fields, CLI flags, ds9-gap-analysis stage)
- `ds9-gap-analysis.ts` — ~200 lines (new file: gap analysis + recovery manifest)
- `.env.example` — 30 lines (new file: all env vars documented)
- `setup.bat` — 74 lines (new file: Windows setup)
- `setup.sh` — 83 lines (new file: Unix setup)
- `.cursor/rules` — 39 lines (new file: AI context)
- `.cursor/worktrees.json` — task + directory config
- `.cursor/...workspace` — launch configs + exclusions
- `.gitignore` — +2 lines (staging, invalid quarantine)

## Appendix B: Environment Variables

| Variable | Required | Used By |
| --- | --- | --- |
| `DATABASE_URL` | Yes | All DB stages, dev server |
| `DEEPSEEK_API_KEY` | For AI analysis | analyze-ai stage |
| `R2_ACCOUNT_ID` | For R2 upload | upload-r2 stage |
| `R2_ACCESS_KEY_ID` | For R2 upload | upload-r2 stage |
| `R2_SECRET_ACCESS_KEY` | For R2 upload | upload-r2 stage |
| `R2_BUCKET_NAME` | For R2 upload | upload-r2 stage |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | For chat UI | server chat features |
| `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | For chat UI | server chat features |
| `PORT` | No (default 3000) | dev server |
| `NODE_ENV` | No | dev server |
