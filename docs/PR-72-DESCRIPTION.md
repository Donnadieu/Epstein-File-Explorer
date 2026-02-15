# Pipeline hardening: security and operational safety

**PR #72** — Security-first improvements to the Epstein File Explorer pipeline (Donnadieu/Epstein-File-Explorer).

---

## Summary

This PR hardens the pipeline with **path traversal safety**, **Zod validation for LLM output**, **PDF resource guardrails**, **AI cost dry-run**, **database transaction safety**, **DS9 gap analysis**, **streaming PDF reads**, and **optional archive checksum verification**. It also adds documentation (`.env.example`, `docs/HARDENING-SECURITY-FIRST-APPROACH.md`) and optional archive integrity checks.

All changes preserve backward compatibility and idempotency. No new runtime dependencies (Zod and p-limit were already in the project).

---

## What’s included

### 1. Security

| Area | Change |
|------|--------|
| **Path traversal (torrent-downloader)** | `safeResolve()` and `safeRmSync()` enforce base-directory containment at 7 call sites. Torrent-derived paths cannot escape the staging/download tree (CWE-22). |
| **LLM output (ai-analyzer)** | DeepSeek JSON is validated with Zod schemas before DB ingestion. Invalid payloads are quarantined to `data/ai-analyzed/invalid/` with metadata. No silent acceptance of malformed data. |
| **Resource exhaustion (pdf-processor)** | `--max-file-size-mb` (default 256), `--max-concurrent-pdfs` (default 4), `pLimit`. Oversize files skipped with logging. PDF read is streamed (file URL or streamed buffer) so capped size is enforced. |
| **Archive integrity (torrent-downloader)** | Optional SHA-256 verification before extraction. Set `expectedSha256` on `TorrentConfig` or use `data/archive-checksums.json` (key = data set ID). `sha256File()` streams the file so 180GB archives are safe. |

### 2. Operational safety

| Area | Change |
|------|--------|
| **AI cost** | `--dry-run` for `analyze-ai`: scans candidates, estimates tokens and cost (DeepSeek pricing), optional `--budget` comparison. Zero API calls. |
| **Database loading (db-loader)** | Batched transactions: persons (100/tx), documents (per-dataset). Rollback on failure; safe re-run. |
| **DS9 completeness** | New stage `ds9-gap-analysis`: scans downloads + extracted, parses EFTA IDs, outputs `data/ds9-recovery-manifest.json` with gaps. `--expected-max-id` supported. |

### 3. Pipeline and CLI

- **run-pipeline.ts**: New options `--dry-run`, `--max-file-size-mb`, `--max-concurrent-pdfs`, `--expected-max-id`. New stage `ds9-gap-analysis` in the sequence.
- **torrent-downloader**: Optional `expectedSha256` per data set; streaming SHA-256 before extract.

### 4. Documentation and DX

- **docs/HARDENING-SECURITY-FIRST-APPROACH.md** — Threat model, patches, before/after, backlog.
- **.env.example** — All required env vars documented.
- **.cursor/rules** — Project context for AI/editor (optional).
- **data/archive-checksums.json.example** — Optional manifest format for archive verification (when used).

---

## Commits in this PR (10)

1. **harden: path traversal safety + Zod validation for LLM output** — `safeResolve`/`safeRmSync`, Zod schemas, quarantine.
2. **feat(pipeline): dry-run, PDF guardrails, batched DB transactions** — Dry-run, max file size, concurrency, DB transactions.
3. **Update .gitignore and README.md** — Docs and ignore rules.
4. **Update package-lock.json** — Lockfile/peer updates.
5. **feat(pipeline): wire ds9-gap-analysis stage into run-pipeline** — DS9 gap stage.
6. **chore: add Cursor rule-files** — `.cursor` rule files.
7. **feat(pipeline): enhance PDF processing and torrent downloading with streaming and integrity checks** — Streaming PDF read, archive SHA-256 verification.
8. **chore: update .cursor/rules** — Rules update.
9. **docs: add HARDENING-SECURITY-FIRST-APPROACH** — Full hardening doc.
10. **Merge lockfile-peer-f9ef1: pipeline hardening, PDF streaming, archive checksums** — Merge of branch.

---

## Files changed

- **scripts/pipeline:** `torrent-downloader.ts`, `ai-analyzer.ts`, `pdf-processor.ts`, `db-loader.ts`, `run-pipeline.ts`, `ds9-gap-analysis.ts` (new)
- **docs:** `HARDENING-SECURITY-FIRST-APPROACH.md` (new)
- **data:** `archive-checksums.json.example` (new, optional)
- **Root/Config:** `.env.example`, `.gitignore`, `README.md`, `.cursor/rules`, `package-lock.json`

---

## How to verify

- **Path safety:** Run `download-torrent --data-sets 1 --max-concurrent 1`; retry after partial extract to confirm safe cleanup.
- **Zod / quarantine:** Run `analyze-ai --limit 5`; check `data/ai-analyzed/invalid/` for any invalid payloads.
- **Dry-run:** Run `analyze-ai --dry-run` (optionally `--budget 50`) to see cost estimate without API calls.
- **PDF guardrails:** Run `process --max-file-size-mb 256 --max-concurrent-pdfs 4` on a dataset with mixed PDF sizes.
- **DS9 gap:** Run `ds9-gap-analysis` (or pipeline with that stage) and inspect `data/ds9-recovery-manifest.json`.
- **Archive checksum:** Add an `expectedSha256` (or `data/archive-checksums.json` entry) for a data set and re-run download + extract; mismatch should fail extraction with a clear error.

---

## Reference

Full write-up: **docs/HARDENING-SECURITY-FIRST-APPROACH.md** (threat model, patch details, before/after tables, backlog).

---

**To update PR #72 on GitHub:** Open [PR #72](https://github.com/Donnadieu/Epstein-File-Explorer/pull/72) → Edit the description (pencil icon) → Replace the body with the contents of this file (or the summary above) → Update the title to e.g. **Pipeline hardening: security and operational safety** → Save.
