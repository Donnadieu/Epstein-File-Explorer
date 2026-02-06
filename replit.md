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

## Recent Changes
- Initial build: Feb 2026
- Database seeded with 20 real individuals, 20 documents, 26 connections, 33 timeline events
- All data sourced from publicly available DOJ releases and court records
