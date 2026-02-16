---
agent: infrastructure
status: complete
issues_found: 12
---

# Infrastructure Review

## Summary
- Environment vars documented: 0/11 (no `.env.example` exists)
- Config validation: Partial (only `DATABASE_URL` validated at startup)
- Deployment ready: Yes (Fly.io + Docker working, CI/CD active)

## Critical Issues

### 1. Secrets exposure risk in `.env`
The `.env` file contains real API keys and credentials including `DEEPSEEK_API_KEY` (duplicated on lines 2-3), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and Fly.io Postgres credentials in comments. While `.env` is in `.gitignore`, these credentials should be rotated if ever committed to history.

### 2. No `.env.example` file
No `.env.example` or `.env.template` exists to document the 11 environment variables the project uses. New developers have no reference for required configuration.

## High Priority

### 3. Port mismatch / macOS AirPlay conflict
`server/index.ts:153` — Server defaults to port 5000 (`process.env.PORT || "5000"`) which conflicts with macOS AirPlay Receiver. The dev script in `package.json` does not set a PORT override.

### 4. Dead Replit integration code
`server/replit_integrations/` — References Replit-specific env vars (`AI_INTEGRATIONS_OPENROUTER_BASE_URL`, `AI_INTEGRATIONS_OPENROUTER_API_KEY`) that do not exist in the Fly.io deployment. Also found in `scripts/pipeline/test-ai.ts`.

### 5. No database migration system
`drizzle.config.ts` — Uses `drizzle-kit push` (direct schema application) with no `migrations/` directory. The `server/migrate.ts` only contains inline SQL for extensions/indexes, not schema migrations. No migration history, no rollbacks, schema state not reproducible from code alone.

### 6. No centralized config validation
`server/db.ts`, `server/r2.ts`, `server/background-worker.ts` — Only `DATABASE_URL` throws on missing. `DEEPSEEK_API_KEY` silently disables features. R2 variables are checked at usage time with generic errors.

## Medium Priority

### 7. Dockerfile `COPY data/ai-analyzed` may fail
`Dockerfile:23` — Will fail if directory is empty or missing in build context.

### 8. Background worker commented out
`server/index.ts:190` — `startBackgroundWorker()` is commented out, but `server/chat/routes.ts` still queues jobs via `queueUnanalyzedDocuments`.

### 9. TypeScript pinned at 5.6.3
Latest is 5.8.x.

### 10. Node.js version mismatch
`.tool-versions` specifies 20.18.1 but Dockerfile uses `node:20-slim`.

### 11. CI/CD pipeline has no tests, linting, or typecheck before deploy
`.github/workflows/deploy.yml` — Only runs `flyctl deploy`.

### 12. Missing security headers
No Helmet, CSP, HSTS, or CORS configuration.

## Environment Variables (11 found, 0 documented)

| Variable | Files | Required | Validated |
|----------|-------|----------|-----------|
| `DATABASE_URL` | `server/db.ts`, `drizzle.config.ts` | Yes | Yes (throws) |
| `DEEPSEEK_API_KEY` | `server/chat/*.ts`, `server/background-worker.ts`, `scripts/pipeline/*.ts` | Yes (AI) | Partial |
| `R2_ACCOUNT_ID` | `server/r2.ts` | Yes (prod) | Partial |
| `R2_ACCESS_KEY_ID` | `server/r2.ts` | Yes (prod) | Partial |
| `R2_SECRET_ACCESS_KEY` | `server/r2.ts` | Yes (prod) | Partial |
| `R2_BUCKET_NAME` | `server/r2.ts` | Yes (prod) | Partial |
| `PORT` | `server/index.ts` | No (default: 5000) | No |
| `NODE_ENV` | `server/index.ts`, `fly.toml` | No | No |
| `BG_ANALYSIS_BUDGET_CENTS` | `server/background-worker.ts` | No (default: 100) | No |
| `DOJ_HEADED` | `scripts/pipeline/doj-scraper.ts` | No | No |
| `AI_INTEGRATIONS_OPENROUTER_*` | `server/replit_integrations/` (LEGACY) | Dead code | No |

## Positive Findings
- Good rate limiting implementation (per-IP, tiered by endpoint cost)
- Proper streaming with connection limiting for PDF/image/video proxy (max 10 concurrent)
- Server-side caching with TTLs for expensive aggregate queries
- Path traversal protection on all file access routes
- Allowed domain whitelist for proxy requests
- R2 key sanitization to prevent injection
- Input validation on API parameters (Zod for bookmarks)
- Multi-stage Dockerfile with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in production
- `--omit=dev` in production npm install
