---
agent: infrastructure
status: complete
issues_found: 12
---

# Infrastructure Review

## Summary
- Environment vars documented: 0/13 (no .env.example exists)
- Config validation: Partial (DATABASE_URL validated at startup, R2 gracefully optional, others unchecked)
- Deployment ready: Yes, with caveats

## Critical Issues

### 1. No .env.example file
New developers have no reference for what variables are needed. The codebase uses 13 environment variables.

### 2. Duplicate DEEPSEEK_API_KEY in .env
The `.env` file has `DEEPSEEK_API_KEY` on both line 2 and line 3. Commented-out Postgres credentials should be removed.

## High Priority

### 3. No health check endpoint
Fly.io config has no `[checks]` section and server has no `/health` endpoint.

### 4. No database migration files
`drizzle.config.ts` references `out: "./migrations"` but no `migrations/` directory exists. Uses `drizzle-kit push` with no versioned migrations.

### 5. Deploy workflow lacks CI gate
Deploy triggers on push to `main` independently of CI passing.

### 6. Deploy uses `--local-only` build
Builds on GitHub Actions runner rather than Fly's remote builders, losing caching.

## Medium Priority

### 7. Dockerfile copies static data directory
`COPY data/ai-analyzed ./data/ai-analyzed` bakes 100+ JSON files into Docker image. Build fails if missing.

### 8. VM resources may be tight
1GB RAM on shared CPUs with Node.js + cache pre-warming + AI API + PDF streaming.

### 9. Replit integration code is dead
`server/replit_integrations/` references legacy OpenRouter env vars, never imported.

### 10. Background worker commented out
`server/index.ts:136` -- imported but disabled, not documented.

### 11. .dockerignore missing test artifacts
Missing: `coverage`, `playwright-report`, `test-results`, `e2e`, `test`.

### 12. Package name mismatch
`package.json` has `"name": "rest-express"` -- generic template name.

## Positive Findings
- Multi-stage Docker build is production-ready
- R2 and DeepSeek degrade gracefully when not configured
- Strong `.gitignore` and `.dockerignore`
- Connection pooling with proper timeouts (max 20, idle 30s)
- Concurrency limits (hard: 50, soft: 25)
- TypeScript strict mode enabled
