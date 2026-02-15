# Epstein File Explorer

A public record explorer for the Jeffrey Epstein case files released by the U.S. Department of Justice. Browse, search, and analyze documents across 12 data sets including court filings, depositions, FBI reports, flight logs, financial records, and more.

Live at [epstein-file-explorer.com](https://epstein-file-explorer.com)

## Features

- **Document Browser** — Paginated, filterable view of all documents with PDF/image/video viewers, redaction status, AI-generated summaries, and keyboard navigation (prev/next)
- **Document Comparison** — Side-by-side document comparison view
- **Full-Text Page Search** — Search across 3.5M+ extracted document pages with highlighted snippets and direct page links
- **People Directory** — 200+ named individuals with categories (key figures, associates, victims, witnesses, legal, political), document counts, and connection counts
- **Person Profiles** — Card-based overview with AI-generated summaries, background sections, key facts, top contacts, email counts, and linked timeline events
- **Wikipedia Integration** — Automated person data enrichment from Wikipedia, including profile photos displayed in the network graph
- **Network Graph** — Interactive D3 force-directed graph visualizing connections between persons, with category/connection-type filtering, time range slider, keyword search, and Wikipedia profile photos
- **Timeline** — 5,400+ chronological events with significance scoring, linked to people and documents
- **Cross-Entity Search** — Search across documents, people, and events with saved searches, search history, and bookmarks
- **AI Insights** — DeepSeek-powered analysis extracting persons, connections, events, locations, key facts, and document classifications from extracted text
- **Export** — JSON and CSV export for documents, persons, and search results
- **Dark/Light Theme** — Full theme support with system preference detection

## Tech Stack

| Layer      | Technology                                                              |
| ---------- | ----------------------------------------------------------------------- |
| Frontend   | React 18, TypeScript, Tailwind CSS, shadcn/ui, Radix UI, D3.js, Recharts, Framer Motion |
| Routing    | Wouter                                                                  |
| Data       | TanStack React Query                                                    |
| Backend    | Express 5, TypeScript, Drizzle ORM, Zod                                 |
| Database   | PostgreSQL (with full-text search indexes)                              |
| Storage    | Cloudflare R2 (documents), local filesystem (staging)                   |
| AI         | DeepSeek API (document analysis, person classification)                 |
| Deployment | Fly.io (US East), Docker multi-stage build                             |

## Data Sources

- **Data origin:** [U.S. Department of Justice](https://www.justice.gov/epstein) — official public releases of case files across 12 data sets
- **Distribution:** [yung-megafone/Epstein-Files](https://github.com/yung-megafone/Epstein-Files) — community archive preserving publicly released materials via torrents after DOJ removed several data sets (9, 10, 11) from their site in February 2026
- **Person data:** [Wikipedia](https://en.wikipedia.org/wiki/List_of_people_named_in_the_Epstein_files) — scraped and enriched with AI classification for categories, roles, and occupations

All data in this project comes from publicly released government records.

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL
- aria2 (for torrent downloads): `brew install aria2`

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL connection string, R2 credentials, DeepSeek API key

# Push database schema
npm run db:push

# Start development server
npm run dev
```

The app runs on port 3000 in development (port 5000 in production).

### Environment Variables

| Variable               | Description                          |
| ---------------------- | ------------------------------------ |
| `DATABASE_URL`         | PostgreSQL connection string         |
| `R2_ACCOUNT_ID`        | Cloudflare R2 account ID             |
| `R2_ACCESS_KEY_ID`     | R2 access key                        |
| `R2_SECRET_ACCESS_KEY` | R2 secret key                        |
| `R2_BUCKET_NAME`       | R2 bucket name                       |
| `R2_PUBLIC_URL`        | R2 public URL for serving documents  |
| `DEEPSEEK_API_KEY`     | DeepSeek API key for AI analysis     |

## Pipeline

The data pipeline handles downloading, processing, and analyzing documents:

```
scrape-wikipedia → download-torrent → import-downloads → upload-r2 → process →
classify-media → analyze-ai → load-persons → load-documents →
load-ai-results → extract-connections → update-counts → dedup-persons
```

For documented issues with the DOJ release (bulk downloads removed, DS9 incomplete, redaction failures, duplication, etc.) and planned pipeline solutions, see [docs/EPSTEIN_FILES_ISSUES_AND_PIPELINE.md](docs/EPSTEIN_FILES_ISSUES_AND_PIPELINE.md).

### Running Pipeline Stages

```bash
# Run a specific stage
npx tsx scripts/pipeline/run-pipeline.ts <stage>

# Download specific data sets via torrent
npx tsx scripts/pipeline/run-pipeline.ts download-torrent --data-sets 1,3,8

# Run all stages
npx tsx scripts/pipeline/run-pipeline.ts all
```

### Pipeline Stages

| Stage                 | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `scrape-wikipedia`    | Scrapes Wikipedia for person list, enriches with DeepSeek AI classification |
| `download-torrent`    | Downloads data sets via BitTorrent (aria2c), extracts archives           |
| `import-downloads`    | Imports downloaded files into the database                               |
| `upload-r2`           | Uploads documents to Cloudflare R2 storage                               |
| `process`             | Extracts text from PDFs using pdf.js                                     |
| `classify-media`      | Classifies documents by media type, assigns AI analysis priority (1-5)   |
| `analyze-ai`          | Two-tier AI analysis: rule-based (free) + DeepSeek API with budget tracking |
| `load-persons`        | Loads persons from Wikipedia scrape into database                        |
| `load-documents`      | Loads document metadata from DOJ catalog                                 |
| `load-ai-results`     | Upserts AI analysis results into database (persons, connections, events) |
| `extract-connections`  | Extracts relationships between persons from descriptions                 |
| `update-counts`       | Recalculates document and connection counts                              |
| `dedup-persons`       | Merges duplicate person records with fuzzy matching                      |

### Data Sets

| DS  | Description                             | Size    | Status                      |
| --- | --------------------------------------- | ------- | --------------------------- |
| 1-8 | Court documents, legal filings          | 1-10 GB | Available via DOJ + torrent |
| 9   | Communications, emails, media           | ~143 GB | DOJ offline — torrent only  |
| 10  | Visual media (180K+ images, 2K+ videos) | ~79 GB  | DOJ offline — torrent only  |
| 11  | Financial ledgers, flight manifests     | ~28 GB  | DOJ offline — torrent only  |
| 12  | Court documents                         | 114 MB  | Available via DOJ + torrent |

For documented problems with the DOJ release (bulk downloads removed, DS9 incomplete, redaction failures, duplication, etc.) and the pipeline’s planned solutions, see [docs/EPSTEIN-FILES-ISSUES-AND-PIPELINE-SOLUTIONS.md](docs/EPSTEIN-FILES-ISSUES-AND-PIPELINE-SOLUTIONS.md). Implementation order is tracked in [docs/PIPELINE-ROADMAP.md](docs/PIPELINE-ROADMAP.md).

## API

### Documents
- `GET /api/documents` — Paginated list with server-side filtering (search, type, dataSet, redacted, mediaType)
- `GET /api/documents/:id` — Document detail with associated persons and timeline events
- `GET /api/documents/:id/adjacent` — Previous/next document IDs for navigation
- `GET /api/documents/:id/pdf` — PDF proxy (streams from R2 or local, handles CORS)
- `GET /api/documents/:id/image` — Image proxy/redirect
- `GET /api/documents/:id/video` — Video proxy with Range request support
- `GET /api/documents/:id/content-url` — Presigned R2 URL
- `GET /api/documents/filters` — Available filter options

### Persons
- `GET /api/persons` — List all persons (with optional pagination)
- `GET /api/persons/:id` — Person detail with documents, connections, timeline events, and AI mentions

### Search
- `GET /api/search` — Cross-entity search (persons, documents, events)
- `GET /api/search/pages` — Full-text page search with headline snippets

### Network & Timeline
- `GET /api/network` — Network graph data (persons + connections with year ranges)
- `GET /api/timeline` — Timeline events with significance scoring

### AI Analysis
- `GET /api/ai-analyses` — List all AI analyses (with optional pagination)
- `GET /api/ai-analyses/aggregate` — Aggregate AI analysis statistics (database-driven)
- `GET /api/ai-analyses/:fileName` — Individual AI analysis detail

### Bookmarks
- `GET /api/bookmarks` — User bookmarks
- `POST /api/bookmarks` — Create bookmark (person/document/search)
- `DELETE /api/bookmarks/:id` — Delete bookmark

### Export
- `GET /api/export/persons` — Export persons (JSON/CSV)
- `GET /api/export/documents` — Export documents (JSON/CSV)
- `GET /api/export/search` — Export search results (JSON/CSV)

### Stats & Pipeline
- `GET /api/stats` — Dashboard statistics
- `GET /api/sidebar-counts` — Sidebar navigation counts
- `GET /api/pipeline/jobs` — Pipeline job status
- `GET /api/pipeline/stats` — Pipeline statistics
- `GET /api/budget` — AI cost budget summary

## Database Schema

9 primary tables managed with Drizzle ORM:

| Table              | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `persons`          | Named individuals with categories, aliases, Wikipedia data, profile sections (JSONB), top contacts |
| `documents`        | Documents with metadata, processing status, R2 storage keys, AI analysis status |
| `document_pages`   | Extracted page content with full-text search indexes                  |
| `connections`      | Relationships between persons with type, strength (1-5), and source documents |
| `person_documents` | Join table linking persons to documents with context and mention type |
| `timeline_events`  | Chronological events with significance scoring, linked to person and document IDs |
| `pipeline_jobs`    | Pipeline task tracking with retry logic                              |
| `budget_tracking`  | AI analysis cost tracking per document/job                           |
| `bookmarks`        | User bookmarks for persons, documents, and searches                  |

## Project Structure

```
client/src/
  pages/              # 12 route pages
    dashboard.tsx      # Home with overview stats
    documents.tsx      # Paginated document browser
    document-detail.tsx # Document viewer (PDF/image/video)
    document-compare.tsx # Side-by-side comparison
    people.tsx         # People directory
    person-detail.tsx  # Person profile (Overview, Documents, Connections, Timeline tabs)
    network.tsx        # D3 force-directed network graph
    timeline.tsx       # Chronological event viewer
    search.tsx         # Cross-entity + full-text page search
    ai-insights.tsx    # AI analysis dashboard
  components/
    network-graph.tsx  # D3 force simulation with zoom/pan/search
    pdf-viewer.tsx     # PDF renderer (pdf.js)
    timeline-viz.tsx   # Timeline visualization
    person-hover-card.tsx # Quick person info popover
    app-sidebar.tsx    # Main navigation
    export-button.tsx  # CSV/JSON export
  hooks/
    use-bookmarks.ts   # Bookmark management
    use-keyboard-shortcuts.ts # Global keyboard shortcuts
    use-search-history.ts # Local search history
    use-url-filters.ts # URL-synced filter state
  components/ui/       # 67 shadcn/ui components
server/
  routes.ts            # 30+ API endpoints
  storage.ts           # Database queries (Drizzle ORM)
  db.ts                # PostgreSQL connection pool
shared/
  schema.ts            # Drizzle schema (9 tables) + Zod validation + TypeScript types
scripts/pipeline/
  run-pipeline.ts      # Pipeline orchestrator (13 stages)
  wikipedia-scraper.ts # Wikipedia person list scraper
  torrent-downloader.ts # BitTorrent download via aria2c
  ai-analyzer.ts       # Two-tier AI analysis (rule-based + DeepSeek)
  db-loader.ts         # Database loading operations
  pdf-processor.ts     # PDF text extraction
  media-classifier.ts  # Media type classification
  r2-migration.ts      # R2 storage upload
  load-pages.ts        # Document page content loader
  generate-profiles.ts # Person profile generation
  doj-scraper.ts       # DOJ catalog scraper
data/                  # Local data (gitignored)
  downloads/           # Downloaded documents by data set
  ai-analyzed/         # AI analysis JSON results
```

## Deployment

Deployed on [Fly.io](https://fly.io) with Docker multi-stage build:

- **Region:** `iad` (US East — Virginia)
- **VM:** 2 shared CPUs, 1 GB RAM
- **Auto-scaling:** Suspends when idle, auto-starts on requests
- **Concurrency:** 25 soft / 50 hard request limit
- **HTTPS:** Forced

```bash
# Deploy
fly deploy

# View logs
fly logs
```

## License

MIT
