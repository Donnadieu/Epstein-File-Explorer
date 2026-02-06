# Epstein Files Explorer

## Overview
A modern, user-friendly web application for exploring the publicly released Epstein case documents. The app is centered around people, making it easy to understand who is involved, what documents mention them, how they're connected, and what happened chronologically.

## Architecture
- **Frontend**: React + TypeScript with Vite, Tailwind CSS, Shadcn UI components
- **Backend**: Express.js REST API
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: Wouter (client-side), Express (server-side)
- **State**: TanStack React Query for server state

## Project Structure
```
client/src/
  pages/          - Dashboard, People, PersonDetail, Documents, DocumentDetail, Timeline, Network, Search
  components/     - AppSidebar, ThemeProvider, ThemeToggle, UI components (Shadcn)
  lib/            - queryClient, utils
server/
  index.ts        - Express app setup, seed on startup
  routes.ts       - API endpoints (/api/stats, /api/persons, /api/documents, /api/timeline, /api/network, /api/search)
  storage.ts      - DatabaseStorage implementing IStorage interface
  db.ts           - Drizzle + pg pool
  seed.ts         - Comprehensive seed data from real public records
shared/
  schema.ts       - Drizzle schemas: persons, documents, connections, personDocuments, timelineEvents
```

## Key Features
1. **Dashboard** - Overview stats, featured people, recent documents, key events
2. **People Directory** - Filterable/searchable list of all individuals, sorted by document count
3. **Person Detail** - Full profile with associated documents and mapped connections
4. **Document Browser** - All documents with filters by type, data set, redaction status
5. **Document Detail** - Full document info with linked people and source links to DOJ
6. **Timeline** - Chronological view of case events from 1953 to 2026
7. **Network** - Relationship connections between people with type filters
8. **Search** - Global search across people, documents, and events

## Data Model
- **persons**: Named individuals with categories (key figure, associate, victim, witness, legal, political)
- **documents**: Public records with types (flight log, deposition, court filing, fbi report, etc.)
- **connections**: Relationships between people with types and strength
- **personDocuments**: Many-to-many linking people to documents with context
- **timelineEvents**: Chronological events with categories and significance levels

## Data Pipeline
```
scripts/pipeline/
  run-pipeline.ts        - Master pipeline orchestrator with stage system
  doj-scraper.ts         - DOJ catalog scraper (with age cookie bypass)
  wikipedia-scraper.ts   - Wikipedia person data scraper
  db-loader.ts           - Database loader (persons, documents, connections, import-downloads)
  document-downloader.ts - Document download manager
  pdf-processor.ts       - PDF text extraction
  entity-extractor.ts    - Entity/relationship extraction from text
tmp/
  download-epstein-all.sh - Bash script for bulk DOJ PDF downloads with probe discovery
```

### Pipeline Commands
```bash
npx tsx scripts/pipeline/run-pipeline.ts quick          # Fast: Wikipedia + persons + connections
npx tsx scripts/pipeline/run-pipeline.ts import-downloads # Import downloaded PDFs to DB
npx tsx scripts/pipeline/db-loader.ts import-downloads    # Direct import from filesystem
bash tmp/download-epstein-all.sh                          # Download all DOJ data sets
bash tmp/download-epstein-all.sh 6                        # Download specific data set
bash tmp/download-epstein-all.sh 1 3                      # Download data sets 1-3
```

### Download Script Details
- Uses `justiceGovAgeVerified=true` cookie to bypass age verification
- Fetches page 0 of each data set listing, then probes EFTA number ranges for remaining files
- Sequential HEAD requests with rate limiting (0.3s per 50 checks) to avoid DOJ rate limiting
- Resume support: skips already-downloaded files
- Downloads saved to `~/Downloads/epstein-disclosures/data-set-{N}/`
- URL lists saved to `~/Downloads/epstein-disclosures/urls/`

## Current Database Stats
- **103 persons** (91 from Wikipedia + 12 seed)
- **630 documents** (540 DOJ catalog + 70 imported PDFs + 20 seed)
- **171 connections** (145 extracted from descriptions + 26 seed)
- **33 timeline events**

## Recent Changes
- Initial build: Feb 2026
- Database seeded with 20 real individuals, 20 documents, 26 connections, 33 timeline events
- All data sourced from publicly available DOJ releases and court records
- Wikipedia scraper: extracted 91 persons with descriptions, aliases, categories
- DOJ download pipeline: bash script with probe-based discovery, 149 PDFs downloaded (DS5-7)
- DB import pipeline: `import-downloads` stage to load downloaded PDFs into database
- DOJ scraper updated with age cookie for Playwright and fetch
