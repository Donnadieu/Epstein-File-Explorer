@echo off
REM =============================================================================
REM Epstein-File-Explorer — Windows Worktree Setup
REM Run from: C:\Users\Amber\OneDrive\DOASpeaks\Desktop\eps\Epstein-File-Explorer
REM =============================================================================

echo.
echo === Epstein-File-Explorer Setup ===
echo.

REM --- 1. Check prerequisites ---
where node >nul 2>&1 || (echo ERROR: Node.js not found. Install from https://nodejs.org && exit /b 1)
where git >nul 2>&1 || (echo ERROR: Git not found. Install from https://git-scm.com && exit /b 1)

for /f "tokens=*" %%v in ('node -v') do echo Node: %%v
for /f "tokens=*" %%v in ('npm -v') do echo npm:  %%v

REM --- 2. Install dependencies ---
echo.
echo [1/5] Installing npm dependencies...
call npm install
if errorlevel 1 (echo ERROR: npm install failed && exit /b 1)

REM --- 3. Create .env if missing ---
if not exist .env (
    echo.
    echo [2/5] Creating .env from .env.example...
    copy .env.example .env
    echo.
    echo *** IMPORTANT: Edit .env and set DATABASE_URL and DEEPSEEK_API_KEY ***
    echo.
) else (
    echo [2/5] .env already exists, skipping.
)

REM --- 4. Create data directories ---
echo [3/5] Creating data directories...
if not exist data\downloads mkdir data\downloads
if not exist data\extracted mkdir data\extracted
if not exist data\ai-analyzed\invalid mkdir data\ai-analyzed\invalid
if not exist data\staging mkdir data\staging

REM --- 5. Type check ---
echo [4/5] Running type check...
call npx tsc --noEmit 2>nul
if errorlevel 1 (
    echo WARNING: Type check has errors (pre-existing issues in client code are expected^)
) else (
    echo Type check passed.
)

REM --- 6. Verify pipeline can parse ---
echo [5/5] Verifying pipeline entry point...
call npx tsx scripts/pipeline/run-pipeline.ts --help >nul 2>&1
if errorlevel 1 (
    echo WARNING: Pipeline entry point failed to parse. Check for syntax errors.
) else (
    echo Pipeline entry point OK.
)

echo.
echo === Setup Complete ===
echo.
echo Next steps:
echo   1. Edit .env with your DATABASE_URL and DEEPSEEK_API_KEY
echo   2. Run: npm run db:push           (create database tables)
echo   3. Run: npm run dev               (start dev server on localhost:3000)
echo   4. Run pipeline stages:
echo      npx tsx scripts/pipeline/run-pipeline.ts --help
echo      npx tsx scripts/pipeline/run-pipeline.ts analyze-ai --dry-run --limit 10
echo.
echo For DS9 gap analysis (once data is downloaded):
echo   npx tsx scripts/pipeline/run-pipeline.ts ds9-gap-analysis
echo.
