# Epstein File Explorer

A public record explorer for the Jeffrey Epstein case files released by the U.S. Department of Justice. Browse, search, and analyze documents across 12 data sets including court filings, depositions, FBI reports, flight logs, financial records, and more.

Live at [epstein-file-explorer.com](https://epstein-file-explorer.com)

## Features

- **Document Browser** — Paginated, filterable view of all documents with PDF viewer, redaction status, and AI-generated summaries
- **People Directory** — named individuals with categories (key figures, associates, victims, witnesses, legal, political), document counts, and connection counts
- **Network Graph** — Interactive D3 force-directed graph visualizing connections between persons
- **Timeline** — 5,400+ chronological events with significance scoring
- **Full-Text Search** — Cross-entity search across documents, people, and events with saved searches and bookmarks
- **AI Insights** — DeepSeek-powered analysis extracting persons, connections, events, and document classifications from extracted text
- **Export** — JSON and CSV export for documents

## Tech Stack

| Layer      | Technology                                                     |
| ---------- | -------------------------------------------------------------- |
| Frontend   | React 18, TypeScript, Tailwind CSS, shadcn/ui, D3.js, Recharts |
| Backend    | Express 5, TypeScript, Drizzle ORM                             |
| Database   | PostgreSQL                                                     |
| Storage    | Cloudflare R2 (documents), local filesystem (staging)          |
| AI         | DeepSeek API (document analysis)                               |
| Deployment | Replit (Autoscale)                                             |

## Data Sources

- **Data origin:** [U.S. Department of Justice](https://www.justice.gov/epstein) — official public releases of case files across 12 data sets
- **Distribution:** [yung-megafone/Epstein-Files](https://github.com/yung-megafone/Epstein-Files) — community archive preserving publicly released materials via torrents after DOJ removed several data sets (9, 10, 11) from their site in February 2026

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

The app runs on port 3000 by default.

### Environment Variables

| Variable               | Description                         |
| ---------------------- | ----------------------------------- |
| `DATABASE_URL`         | PostgreSQL connection string        |
| `R2_ACCOUNT_ID`        | Cloudflare R2 account ID            |
| `R2_ACCESS_KEY_ID`     | R2 access key                       |
| `R2_SECRET_ACCESS_KEY` | R2 secret key                       |
| `R2_BUCKET_NAME`       | R2 bucket name                      |
| `R2_PUBLIC_URL`        | R2 public URL for serving documents |
| `DEEPSEEK_API_KEY`     | DeepSeek API key for AI analysis    |

## Pipeline

The data pipeline handles downloading, processing, and analyzing documents:

```
scrape-wikipedia → download-torrent → import-downloads → upload-r2 → process →
classify-media → analyze-ai → load-persons → load-documents →
load-ai-results → extract-connections → update-counts → dedup-persons
```

### Running Pipeline Stages

```bash
# Run a specific stage
npx tsx scripts/pipeline/run-pipeline.ts <stage>

# Download specific data sets via torrent
npx tsx scripts/pipeline/run-pipeline.ts download-torrent --data-sets 1,3,8

# Run all stages
npx tsx scripts/pipeline/run-pipeline.ts all
```

### Data Sets

| DS  | Description                             | Size    | Status                      |
| --- | --------------------------------------- | ------- | --------------------------- |
| 1-8 | Court documents, legal filings          | 1-10 GB | Available via DOJ + torrent |
| 9   | Communications, emails, media           | ~143 GB | DOJ offline — torrent only  |
| 10  | Visual media (180K+ images, 2K+ videos) | ~79 GB  | DOJ offline — torrent only  |
| 11  | Financial ledgers, flight manifests     | ~28 GB  | DOJ offline — torrent only  |
| 12  | Court documents                         | 114 MB  | Available via DOJ + torrent |

## Project Structure

```
client/src/           # React frontend
  components/         # UI components (sidebar, network graph, PDF viewer, etc.)
  pages/              # Route pages (dashboard, documents, people, timeline, etc.)
  hooks/              # Custom hooks (URL filters, mobile detection)
server/               # Express backend
  routes.ts           # API endpoints
  storage.ts          # Database queries
  db.ts               # Database connection
shared/               # Shared types
  schema.ts           # Drizzle ORM schema (8 tables)
scripts/pipeline/     # Data pipeline scripts
  run-pipeline.ts     # Pipeline orchestrator
  torrent-downloader.ts
  media-classifier.ts
  db-loader.ts
  r2-migration.ts
data/                 # Local data (gitignored)
  downloads/          # Downloaded documents by data set
  ai-analyzed/        # AI analysis JSON results
```

## License

MIT
