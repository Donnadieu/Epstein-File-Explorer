---
agent: test-coverage
status: complete
issues_found: 14
---

# Test Coverage Review

## Summary
- Total test files found: 0
- Test framework: None configured
- Overall coverage assessment: **Poor** — No tests exist anywhere in the project

The project has zero test files. There is no test runner configured (no vitest, jest, mocha, or any test-related dependency in devDependencies). No `test` script in package.json. The project has substantial server-side logic, complex utility functions, 19 pipeline scripts, 25+ API endpoints, and 12 frontend pages — all completely untested.

## Critical Gaps (no tests at all)

1. **Database Schema and Models** (`shared/schema.ts`) — 8+ tables, 6 Zod insert schemas, complex relations — zero tests
2. **Storage Layer** (`server/storage.ts`) — `DatabaseStorage` class with 30+ methods, person deduplication logic (`isSamePerson`, `normalizeName`, `deduplicatePersons`) with edit distance, nickname maps, OCR space collapse — the most test-worthy code in the project
3. **API Routes** (`server/routes.ts`) — 25+ REST endpoints, helper functions `isAllowedPdfUrl`, `escapeCsvField`, `toCsvRow`, `omitInternal` — all untested
4. **Chat / AI Integration** (`server/chat/`) — `chunkText`, `calculateCostCents`, `buildTsQuery`, `extractKeywords`, `matchesPersonName`, `stripHtmlTags` — all pure functions, all untested
5. **R2 Cloud Storage** (`server/r2.ts`) — `buildR2Key` sanitization logic with security implications (path traversal prevention) — untested
6. **Pipeline Scripts** (`scripts/pipeline/`) — 19 pipeline scripts with zero test coverage
7. **Background Worker** (`server/background-worker.ts`) — `processOneJob`, `isJunkName`, `inferStatus`, `getTodaySpend` — untested
8. **Migration System** (`server/migrate.ts`) — Custom migration runner with 7 migrations — untested
9. **Rate Limiting** (`server/index.ts`) — Custom `rateLimit` middleware — untested
10. **Seed Data** (`server/seed.ts`) — `seedDatabase` with complex data relationships — no integration tests

## High Priority (partial coverage)
- **Security-sensitive code untested**: `buildR2Key` (path traversal), `isAllowedPdfUrl` (domain whitelist), fileName validation
- **Person name matching** (lines 154-395 in `server/storage.ts`): `normalizeName`, `isSamePerson`, `collapseOCRSpaces`, `editDistance` — a single bug could silently merge unrelated people

## Medium Priority (could improve)
- Frontend Hooks (`client/src/hooks/`) — 5 custom hooks untested
- Frontend Pages (`client/src/pages/`) — 12 pages, no component tests
- Frontend Components (`client/src/components/`) — 10 custom + 38 shadcn/ui components
- Client Utilities (`client/src/lib/queryClient.ts`) — `apiRequest`, `throwIfResNotOk`, `getQueryFn` untested

## Detailed Findings

### Pure Utility Functions (Low-Hanging Fruit for Testing)
All testable immediately with no mocking:
- `buildTsQuery`, `extractKeywords`, `stripHtmlTags`, `truncateToLimit`
- `chunkText`, `calculateCostCents`
- `escapeCsvField`, `toCsvRow`, `escapeLikePattern`
- `isJunkName`, `inferStatus`
- `normalizeName`, `isSamePerson`, `editDistance`

### Recommended Test Priority
1. **Immediate**: Install vitest, write unit tests for `normalizeName`, `isSamePerson`, `buildTsQuery`, `buildR2Key`, `isAllowedPdfUrl`
2. **Short-term**: Unit tests for all pure utility functions
3. **Medium-term**: Integration tests for critical API endpoints using supertest
4. **Long-term**: Frontend component tests, E2E tests with Playwright (already in devDependencies)
