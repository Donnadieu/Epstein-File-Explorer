# Pipeline Roadmap: Documented Issues → Implementation

This roadmap tracks pipeline work that addresses the
[documented issues](EPSTEIN-FILES-ISSUES-AND-PIPELINE-SOLUTIONS.md)
with the DOJ Epstein Files release.

## Priority queue

<!-- markdownlint-disable MD013 -->
| # | Stage / feature | Status | Notes |
| --- | --- | --- | --- |
| 1 | **DS9 gap analysis + recovery scraper** | Not started | Enumerate EFTA IDs in local DS9, output recovery manifest; DOJ scraper for missing PDFs (rate-limited, resume). |
| 2 | **Master index CSV/JSON export** | Not started | Flat mapping: EFTA ID → dataset, date, doc type, page count, persons, one-line summary. |
| 3 | **Redaction audit stage** | Not started | Flag docs where text exists under redaction bounding boxes; ethical: flag only, do not publish recovered text. |
| 4 | **Document deduplication (content fingerprint)** | Not started | SimHash/MinHash of extracted text; dedup-documents stage; redaction-diff and canonical-version for clusters. |
| 5 | **Archive integrity verification** | Not started | verify-archive stage vs yung-megafone/Epstein-Files checksums; report present vs missing EFTA IDs per set. |
| 6 | **Re-OCR for low-quality extractions** | Not started | reocr stage (e.g. Tesseract 5); text-quality score; store original + re-OCR; AI uses best. |
| 7 | **DOJ diff tracking** | Not started | diff-against-doj stage; provenance-log; versioning when re-redacted docs reappear. |
| 8 | **Thread reconstruction (DS9 emails)** | Not started | Group by In-Reply-To / References / Subject; expose in API and UI. |
<!-- markdownlint-enable MD013 -->

## Already in pipeline

<!-- markdownlint-disable MD013 -->
- **Torrent downloader** — bulk access after DOJ removed ZIPs (Issue 1).
- **Path safety + Zod validation** — hardened cleanup and LLM output validation.
- **Dry-run, PDF guardrails, batched DB transactions** — cost preview, oversize skip,
  concurrency limit, atomic loads.
- **Timeline + AI classification** — partial answer to Issue 5 (chronology) and
  Issue 8 (scale).
- **dedup-persons** — person-level dedup only; document-level is Priority 4.

## How to use this

- When starting work, set the row’s **Status** to `In progress` and add a **Notes** line
  (e.g. branch or design choice).
- When done, set **Status** to `Done` and add a short note (e.g. PR or stage name).
- New issues from research can be added as new rows and linked to the main doc.
<!-- markdownlint-enable MD013 -->
