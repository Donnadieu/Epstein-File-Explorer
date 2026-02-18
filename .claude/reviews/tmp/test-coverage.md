---
agent: test-coverage
status: complete
issues_found: 18
---

# Test Coverage Review

## Summary
- Total test files found: 4 (3 unit test files + 1 E2E spec)
- Backend test coverage: Partial -- routes test covers ~51% of endpoints; storage utility functions well tested; chat/R2/worker have zero tests
- Frontend test coverage: Zero test files
- E2E test coverage: Minimal -- only verifies pages load

## Existing Test Files
1. `server/__tests__/routes.test.ts` -- 48 test cases covering 20 of 39 API routes
2. `server/__tests__/storage.unit.test.ts` -- 22 test cases for `normalizeName` (8) and `isSamePerson` (14)
3. `shared/__tests__/schema.test.ts` -- 12 test cases validating 5 Zod insert schemas
4. `e2e/health.spec.ts` -- 5 Playwright smoke tests

## Critical Gaps (no tests at all)
1. **Chat service** (`server/chat/service.ts`) - streaming AI chat, history truncation
2. **Chat retriever** (`server/chat/retriever.ts`) - RAG context builder with 5+ pure utility functions
3. **Chat extractor** (`server/chat/extractor.ts`) - `buildTsQuery` pure function
4. **Chat analyze** (`server/chat/analyze.ts`) - `chunkText`, `calculateCostCents` pure functions
5. **Chat routes** (`server/chat/routes.ts`) - 5 untested endpoints
6. **R2 integration** (`server/r2.ts`) - `buildR2Key` (security-relevant), `isR2Configured`, `getPublicUrl`
7. **Background worker** (`server/background-worker.ts`) - `isJunkName`, `inferStatus` pure functions
8. **Storage DB methods** (`server/storage.ts`) - 30+ database query methods, zero integration tests
9. **Frontend components** (17 custom components) - zero tests
10. **Frontend pages** (13 pages) - zero tests
11. **Frontend hooks** (12 custom hooks) - zero tests
12. **Pipeline scripts** (19 scripts) - zero tests

## High Priority (partial coverage)
13. **19 of 39 routes untested** including all vote routes (8), trending routes (4), content proxy routes (pdf/image/video), and the views endpoint
14. **Route helper functions untested** - `isAllowedPdfUrl` (security), `escapeCsvField`, `toCsvRow`, `toPublicDocument` (not exported)
15. **Schema tests missing 10+ insert schemas** - only 5 of 15+ schemas tested

## Medium Priority (could improve)
16. **Storage `createCache` utility** - pure caching logic, untested
17. **E2E smoke-test only** - no user flow coverage
18. **Storage `readAllAnalysisFiles` and `r2Filter`** - file I/O and R2 filtering, untested

## Key Finding: Coverage Config Masks Gaps
The `vitest.config.ts` explicitly excludes `server/r2.ts`, `server/chat/**`, and `server/background-worker.ts` from coverage. This hides the fact that security-relevant code (`buildR2Key` path traversal prevention) and core business logic (AI chat, document analysis) have zero test coverage.

## Recommended Priority
- **Tier 1 (immediate)**: Pure functions with security implications -- `buildR2Key`, `isAllowedPdfUrl`, `buildTsQuery`, `chunkText`, `calculateCostCents`, `extractKeywords`, `isJunkName`, `inferStatus`
- **Tier 2 (short-term)**: Vote and trending route tests (12 untested endpoints), content proxy routes
- **Tier 3 (medium-term)**: Storage integration tests, chat retriever with mocked storage
- **Tier 4 (long-term)**: Frontend hooks, component tests, full E2E user flows
