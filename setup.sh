#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Epstein-File-Explorer — Worktree Setup (Linux/Mac/WSL)
# =============================================================================

echo ""
echo "=== Epstein-File-Explorer Setup ==="
echo ""

# --- 1. Check prerequisites ---
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found. Install from https://nodejs.org"; exit 1; }
command -v git >/dev/null 2>&1  || { echo "ERROR: Git not found."; exit 1; }

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

# --- 2. Install dependencies ---
echo ""
echo "[1/6] Installing npm dependencies..."
npm install

# --- 3. Create .env if missing ---
if [ ! -f .env ]; then
    echo ""
    echo "[2/6] Creating .env from .env.example..."
    cp .env.example .env
    echo ""
    echo "*** IMPORTANT: Edit .env and set DATABASE_URL and DEEPSEEK_API_KEY ***"
    echo ""
else
    echo "[2/6] .env already exists, skipping."
fi

# --- 4. Create data directories ---
echo "[3/6] Creating data directories..."
mkdir -p data/downloads data/extracted data/ai-analyzed/invalid data/staging

# --- 5. Check for PostgreSQL ---
echo "[4/6] Checking PostgreSQL..."
if command -v psql >/dev/null 2>&1; then
    echo "  psql found: $(psql --version | head -1)"
else
    echo "  WARNING: psql not found. You'll need PostgreSQL accessible via DATABASE_URL."
    echo "  Options: install locally, use Docker, or use a cloud DB (Neon, Supabase, etc.)"
fi

# --- 6. Check for aria2c (needed for torrent downloads) ---
echo "[5/6] Checking optional tools..."
if command -v aria2c >/dev/null 2>&1; then
    echo "  aria2c: $(aria2c --version | head -1)"
else
    echo "  aria2c not found (needed for download-torrent stage)"
    echo "  Install: brew install aria2 (Mac) / apt install aria2 (Linux)"
fi

if command -v zstd >/dev/null 2>&1; then
    echo "  zstd: $(zstd --version | head -1)"
else
    echo "  zstd not found (needed for DS9 tar.zst extraction)"
    echo "  Install: brew install zstd (Mac) / apt install zstd (Linux)"
fi

# --- 7. Type check ---
echo "[6/6] Running type check..."
if npx tsc --noEmit 2>/dev/null; then
    echo "  Type check passed."
else
    echo "  WARNING: Type check has errors (pre-existing client issues are expected)"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your DATABASE_URL and DEEPSEEK_API_KEY"
echo "  2. npm run db:push           # create database tables"
echo "  3. npm run dev               # start dev server on localhost:3000"
echo "  4. Pipeline stages:"
echo "     npx tsx scripts/pipeline/run-pipeline.ts --help"
echo "     npx tsx scripts/pipeline/run-pipeline.ts analyze-ai --dry-run --limit 10"
echo ""
echo "For DS9 gap analysis (once data is downloaded):"
echo "  npx tsx scripts/pipeline/run-pipeline.ts ds9-gap-analysis"
echo ""
