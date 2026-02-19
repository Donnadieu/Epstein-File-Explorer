# Typesense Deployment Guide

Self-hosted Typesense on Fly.io for the Epstein File Explorer search.

## What This Does

Replaces slow PostgreSQL full-text search with Typesense (sub-50ms results across 3.5M pages). The app auto-falls back to PostgreSQL when Typesense is unavailable, so this is a zero-risk upgrade.

## Prerequisites

- Fly.io CLI installed: `brew install flyctl` (or `curl -L https://fly.io/install.sh | sh`)
- Fly.io account: `fly auth login`
- Your main app's DATABASE_URL (from `fly secrets list -a <your-main-app>`)

---

## Step 1: Generate an API Key

```bash
openssl rand -hex 32
```

Save this key — you'll use it in **two places**: the Typesense server and your main app.

---

## Step 2: Deploy Typesense on Fly.io

```bash
# From the typesense/ directory
cd typesense

# Create the Fly app (say NO to deploying now)
fly launch --no-deploy

# Create persistent storage (10GB, same region as your app)
fly volumes create typesense_data --region iad --size 10

# Set the API key as a secret
fly secrets set TYPESENSE_API_KEY=<your-key-from-step-1>

# Deploy
fly deploy

# Verify it's running
fly status
```

**Verify health:**
```bash
# From inside Fly's network (e.g., fly ssh console on your main app)
curl http://epstein-typesense.internal:8108/health

# Expected response: {"ok":true}
```

---

## Step 3: Connect Your Main App

Set these env vars on your **main** Fly app (not the Typesense app):

```bash
fly secrets set \
  TYPESENSE_HOST=epstein-typesense.internal \
  TYPESENSE_API_KEY=<your-key-from-step-1> \
  -a <your-main-app-name>
```

After this, your app will try Typesense first on every search and fall back to PostgreSQL if it fails.

---

## Step 4: Index Your Data

Run the indexing script. This reads all ~3.5M pages from PostgreSQL and sends them to Typesense in batches of 5,000.

**Option A: From a Fly machine (recommended — fast, internal network)**
```bash
# SSH into your main app
fly ssh console -a <your-main-app-name>

# Run the indexer
DATABASE_URL=<your-db-url> \
TYPESENSE_HOST=epstein-typesense.internal \
TYPESENSE_API_KEY=<your-key> \
npx tsx scripts/typesense-index.ts
```

**Option B: From your local machine (slower — goes over internet)**
```bash
# You'll need the Typesense app exposed publicly or use fly proxy
fly proxy 8108:8108 -a epstein-typesense &

DATABASE_URL=<your-db-url> \
TYPESENSE_HOST=localhost \
TYPESENSE_API_KEY=<your-key> \
npm run typesense:index
```

**Indexing takes a while** (~3.5M pages). Progress is logged every 50K pages. If it crashes, resume with:
```bash
npm run typesense:index -- --start-from=<last-cursor-id>
```

**Dry run** (validates without writing):
```bash
npm run typesense:index -- --dry-run
```

---

## Step 5: Verify Search Works

1. Open your app in a browser
2. Type a search query — results should appear as you type (200ms debounce)
3. Check server logs for Typesense vs PostgreSQL:
   ```bash
   fly logs -a <your-main-app-name>
   ```
   You should see: `Typesense: healthy` at startup

---

## Environment Variables Reference

| Variable | Where | Required | Description |
|----------|-------|----------|-------------|
| `TYPESENSE_API_KEY` | Typesense Fly app | Yes | The key you generated in Step 1 |
| `TYPESENSE_HOST` | Main app | Yes | `epstein-typesense.internal` (Fly internal DNS) |
| `TYPESENSE_API_KEY` | Main app | Yes | Same key as above |
| `TYPESENSE_PORT` | Main app | No | Default: `8108` |
| `TYPESENSE_PROTOCOL` | Main app | No | Default: `http` |
| `TYPESENSE_SEARCH_API_KEY` | Main app | No | Optional separate read-only key |

---

## How Fallback Works

Every search follows this pattern:
1. Is `TYPESENSE_HOST` set? If no → use PostgreSQL directly
2. Try Typesense query
3. If Typesense fails (timeout, connection error, etc.) → catch error, use PostgreSQL
4. App works exactly the same either way

This means:
- **No Typesense deployed yet?** App works fine on PostgreSQL
- **Typesense goes down?** App auto-recovers to PostgreSQL
- **Want to disable Typesense?** Just unset the env var

---

## Troubleshooting

**Typesense won't start:**
```bash
fly logs -a epstein-typesense
# Check for API key issues or volume mount problems
```

**Indexing fails:**
```bash
# Check Typesense is healthy
curl http://epstein-typesense.internal:8108/health

# Resume from where it stopped
npm run typesense:index -- --start-from=<last-id>
```

**Search still slow after indexing:**
```bash
# Verify collection exists and has documents
curl "http://epstein-typesense.internal:8108/collections/document_pages" \
  -H "X-TYPESENSE-API-KEY: <your-key>"
# Look at num_documents in the response
```

**Want to re-index from scratch:**
```bash
npm run typesense:index
# (Without --start-from, it drops and recreates the collection)
```
