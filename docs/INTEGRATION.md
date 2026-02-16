# Integration Architecture

This document describes how the Python tools (`unredact-main` and `x-ray-main`) are integrated with the Node.js/TypeScript backend.

## Overview

The Epstein File Explorer is a full-stack application with:

- **Frontend**: React 18 + TypeScript (served via Vite in dev, static files in production)
- **Backend**: Node.js + Express + TypeScript
- **Analytics**: PostgreSQL + Drizzle ORM
- **Python Tools**: Two CLI-based PDF analysis tools running as child processes

```
┌─────────────────────┐
│   React Frontend    │
│   (Vite + SPA)      │
└──────────┬──────────┘
           │
           │ HTTP/JSON
           │
┌──────────▼──────────────────────┐
│   Express Server (Node.js/TS)    │
│                                  │
│  ┌────────────────────────────┐  │
│  │  Routes & API Handlers     │  │
│  │  /api/* endpoints          │  │
│  └────┬───────────────────────┘  │
│       │                           │
│  ┌────▼──────────────────────┐   │
│  │   Python Bridge Module    │   │
│  │  (python-tools.ts)        │   │
│  │  - Spawns Python processes│   │
│  │  - Manages I/O            │   │
│  │  - Error handling         │   │
│  └────┬───────────────────────┘   │
└───────┼──────────────────────────┘
        │
        │ child_process.execFile()
        │
    ┌───▼──────────────────────────────────┐
    │   Python Tools (CLI-based)           │
    │                                      │
    │  ┌──────────────────────────────┐   │
    │  │  unredact-main/              │   │
    │  │  - redaction_audit.py        │   │
    │  │  - redact_extract.py         │   │
    │  │  Dependencies:               │   │
    │  │  - pdfplumber >= 0.11.8      │   │
    │  │  - pymupdf >= 1.26.7         │   │
    │  └──────────────────────────────┘   │
    │                                      │
    │  ┌──────────────────────────────┐   │
    │  │  x-ray-main/                 │   │
    │  │  - xray library module       │   │
    │  │  - python -m xray CLI        │   │
    │  │  Dependencies:               │   │
    │  │  - PDF analysis libs         │   │
    │  └──────────────────────────────┘   │
    │                                      │
    │  Both read PDFs from filesystem     │
    │                                      │
    └──────────────────────────────────────┘
```

## File Structure

```
project-root/
├── RUN.sh                          ← Main entrypoint (dev/build/start)
├── server/
│   ├── index.ts                    ← Express server initialization
│   ├── routes.ts                   ← API route definitions (includes Python endpoints)
│   ├── python-tools.ts             ← Bridge module for Python process management
│   └── ... (other server modules)
├── tools/
│   ├── unredact-main/
│   │   ├── redaction_audit.py      ← Analyze redaction quality
│   │   ├── redact_extract.py       ← Extract hidden text
│   │   └── pyproject.toml
│   └── x-ray-main/
│       ├── xray/
│       │   └── __main__.py         ← CLI entry point
│       └── pyproject.toml
├── scripts/
│   ├── setup-python.sh             ← Install Python tool dependencies
│   └── smoke_test.sh               ← Integration validation test
├── package.json                    ← Node dependencies + setup scripts
└── docs/
    └── INTEGRATION.md              ← This file
```

## How It Works

### 1. Startup Sequence (`RUN.sh`)

```bash
./RUN.sh dev
```

1. **Check prerequisites** (Node.js, npm, Python 3)
2. **Install Node dependencies** (`npm install`)
3. **Install Python dependencies** (`scripts/setup-python.sh`)
4. **Start Express server** (`npm run dev`)

### 2. Python Tools Setup (`scripts/setup-python.sh`)

- Detects system Python 3
- Installs both tools' dependencies using `uv` (faster) or `pip` (fallback)
- Verifies installations (imports test)

### 3. Server Initialization (`server/index.ts`)

- Imports the Python bridge module
- Calls `verifyPythonToolsSetup()` to check availability
- On production: exits if tools unavailable
- On development: warns but continues
- Registers API routes

### 4. API Routes (`server/routes.ts`)

Python tools are exposed via REST endpoints:

```
POST /api/tools/health
  ↓
  Returns Python tools status (ready?, versions, etc.)

POST /api/tools/audit-redaction?path=/path/to/file.pdf
  ↓
  Runs redaction_audit.py
  Returns: { success, audit: {...} }

POST /api/tools/xray?path=/path/to/file.pdf
  ↓
  Runs x-ray analysis
  Returns: { success, analysis: {...} }

POST /api/tools/extract-text?path=/path/to/file.pdf&output=/path/to/out.json
  ↓
  Runs redact_extract.py to recover hidden text
  Returns: { success, outputPath }

POST /api/tools/analyze?path=/path/to/file.pdf&extract=true
  ↓
  Runs all three (audit + xray + optional extraction)
  Returns: { success, audit, xray, extractedPath?, errors }
```

### 5. Python Tools Bridge (`server/python-tools.ts`)

Core module that:

- **Spawns Python processes** via Node's `child_process.execFile()`
- **Passes arguments** safely (no shell injection risk)
- **Captures output** (stdout/stderr, 10MB buffer for large PDFs)
- **Parses JSON** responses from Python scripts
- **Handles errors** gracefully (timeouts, missing files, etc.)
- **Provides verification** — checks if dependencies are installed

Each function returns a promise with structure:
```ts
{
  success: boolean,
  data?: any,        // Parsed JSON from Python
  error?: string,    // Error message
  stderr?: string    // Raw stderr for debugging
}
```

## Integration Rules

### ✓ Allowed

- Calling Python tools as CLI utilities (via `child_process`)
- Reading/writing to local filesystem
- Running tools for each PDF independently
- Parallel execution (multiple workers via background processes)
- Storing Python tool outputs in database
- Error handling and logging

### ✗ NOT Allowed

- Modifying PDF files (read-only)
- Network calls between Python and Node.js
- Cloud dependencies (all local)
- Removing existing features
- Touching `/media/USER/Court` data paths (only code wiring)

## Development Workflow

### Starting the integrated system:

```bash
# Option 1: Use unified entry point
./RUN.sh dev

# Option 2: Manual steps
npm run setup-python          # Install Python deps (one-time)
npm run dev                   # Start Express + Vite dev server
```

### Testing Python tools directly:

```bash
# From repo root
cd tools/unredact-main
python3 redaction_audit.py /path/to/pdf.pdf

cd ../x-ray-main
python3 -m xray /path/to/pdf.pdf
```

### Testing API endpoints:

```bash
# Health check
curl http://localhost:5000/api/tools/health

# Audit a specific PDF
curl -X POST http://localhost:5000/api/tools/audit-redaction?path=/path/to/file.pdf

# Full analysis
curl -X POST "http://localhost:5000/api/tools/analyze?path=/path/to/file.pdf&extract=true"
```

## Smoke Testing

Run the integration validation test:

```bash
bash scripts/smoke_test.sh
```

This verifies:
- TypeScript compilation
- Python tool dependencies installed
- Bridge module loads and initializes
- All integration files present
- npm scripts configured correctly
- PDF tool entry points exist

## Example: Processing a PDF End-to-End

1. **Frontend user uploads PDF**
   ```
   POST /api/upload?file=suspicious.pdf
   ```

2. **Backend stores it locally**
   ```ts
   const storagePath = `/tmp/uploads/suspicious.pdf`
   ```

3. **Backend triggers analysis via Express route**
   ```
   POST /api/tools/analyze?path=/tmp/uploads/suspicious.pdf&extract=true
   ```

4. **Python bridge spawns processes**
   ```
   ├─ python3 tools/unredact-main/redaction_audit.py ...
   ├─ python3 -m xray ...
   └─ python3 tools/unredact-main/redact_extract.py ...
   ```

5. **Results captured in JSON**
   ```json
   {
     "success": true,
     "audit": { "redaction_boxes_found": 5, ... },
     "xray": { "bad_redactions": [...] },
     "extractedPath": "/tmp/uploads/suspicious.pdf.extracted.json"
   }
   ```

6. **Frontend displays results**
   - Redaction audit summary
   - Bad redaction warnings
   - Recovered text preview

## Troubleshooting

### Python tools not found

```bash
bash scripts/setup-python.sh
```

### "Python 3 not found"

Install Python 3.12+ and add to PATH:
```bash
# macOS
brew install python@3.12

# Ubuntu/Debian
sudo apt-get install python3.12

# Verify
python3 --version
```

### Import errors (pdfplumber, fitz, xray)

Re-run setup:
```bash
npm run setup-python
```

Or manually:
```bash
cd tools/unredact-main && pip install -e .
cd ../x-ray-main && pip install -e .
```

### Smoke test fails

Check individual components:
```bash
# Check Node.js
npm run check

# Check Python
python3 -c "import pdfplumber, fitz, xray; print('OK')"

# Check bridge
node --input-type=module --eval "import('./server/python-tools.js').then(m => console.log(m.default.verifyPythonToolsSetup()))"
```

## Performance Notes

- Python tools run as **child processes** (isolated, safe)
- Each PDF analysis is **3 separate CLI calls** (audit, xray, extract)
- **No persistent Python VM** — each call spawns fresh process
- File I/O dominates timing (network-like for large PDFs)
- Use **background worker** for batch processing to avoid blocking API

Example for background processing:
```ts
// In background-worker.ts
const result = await analyzePDF(pdfPath, { extract: true });
await storage.savePDFAnalysis(pdfPath, result);
```

## Future Enhancements

- [ ] **WebSocket streaming** for real-time progress updates
- [ ] **Process pooling** to reuse Python VMs for batch jobs
- [ ] **Caching** of analysis results
- [ ] **Queue-based processing** (Bull/Redis) for large batches
- [ ] **Distributed analysis** (Celery/Python async)
- [ ] **Custom x-ray rules** configuration
- [ ] **Redaction recovery modes** (side-by-side, overlay, etc.)

## License & Attribution

- **unredact-main**: Original by [@leedrake5](https://github.com/leedrake5/unredact)
- **x-ray-main**: Original by [@freelawproject](https://github.com/freelawproject/x-ray)
- **Integration & wiring**: This project's Node.js bridge module
