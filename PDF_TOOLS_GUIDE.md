# PDF Analysis Tools - User Guide

## Access the PDF Tools Interface

**Local Development URL:**
```
http://localhost:5000/pdf-tools
```

**What You Can Do:**

1. **Browse PDF Files**
   - Navigate through your filesystem
   - View directory contents with file sizes
   - Filter by PDF files only
   - See redaction quality immediately

2. **Analyze PDFs**
   - Select any PDF file
   - Click "Analyze PDF" to run all tools
   - See results in three tabs:
     - **Audit** - Redaction method classification
     - **X-ray** - Bad redaction detection
     - **Extract** - Path to extracted text

3. **View Results**
   - **File Size** - Total PDF size in bytes
   - **Pages** - Number of pages
   - **Encrypted** - Encryption status
   - **Fonts/Images** - Media analysis
   - **Classification** - Risk level categorization
   - **Copy Results** - Export analysis as JSON

## Common Paths to Analyze

### Test PDFs (included in the project):
```
/path/to/Epstein-File-Explorer/tools/x-ray-main/tests/assets/
```

Examples:
- `hidden_text_on_visible_text.pdf` - Contains hidden text under visible redactions
- `bad_cross_hatched_redactions.pdf` - Poorly executed cross-hatched redactions
- `rect_ordering_6.19.pdf` - Rectangle ordering issues

### Your Data:
```
/path/to/Epstein-File-Explorer/data/
```

## API Endpoints

All functionality is available through REST APIs:

**Browse Files:**
```bash
curl "http://localhost:5000/api/tools/browse?dir=/path/to/directory"
```

**Analyze PDF:**
```bash
curl -X POST "http://localhost:5000/api/tools/analyze?path=/path/to/file.pdf&extract=true"
```

**Redaction Audit Only:**
```bash
curl -X POST "http://localhost:5000/api/tools/audit-redaction?path=/path/to/file.pdf"
```

**X-ray Detection:**
```bash
curl -X POST "http://localhost:5000/api/tools/xray?path=/path/to/file.pdf"
```

**Text Extraction:**
```bash
curl -X POST "http://localhost:5000/api/tools/extract-text?path=/path/to/file.pdf"
```

## Output Files

Results are saved locally:

**Redaction Audits:**
```
/path/to/Epstein-File-Explorer/tools/unredact-main/reports/
{pdf_name}.redaction_audit.json
```

**Extracted Text:**
```
{same directory as PDF}/{filename}.pdf.extracted.json
```

## Privacy

✓ All analysis runs locally on your machine
✓ No data sent to external servers
✓ All results stored in your filesystem
✓ Complete control over file access

## Keyboard Shortcuts

- `Tab` - Navigate between file browser and results
- `Enter` - Activate file/analyze button
- `Ctrl+C` in file list - Copy file path

## Troubleshooting

**Tools Not Ready:**
- Run: `python3 -c "import pdfplumber, fitz; import pikepdf"`
- If missing: `pip install pikepdf pdfplumber pymupdf`

**File Not Found:**
- Verify the full path is correct
- Check file permissions
- Ensure PDF exists at the specified location

**Analysis Hanging:**
- Large PDF files may take time to process
- Check server logs: Press Ctrl+C to stop and restart
- Try with a smaller PDF first

## Troubleshooting

### Error: "JSON.parse: unexpected character"
This usually indicates a temporary server issue that has since been fixed. Try these steps:

1. **Hard refresh the page** - `Ctrl+Shift+R` (clears browser cache)
2. **Verify server is running** - check if you see `serving on port 5000` in terminal
3. **Test the API directly:**
   ```bash
   curl -s http://localhost:5000/api/tools/health
   ```

### Upload Not Working
- Check file size (max 100MB)
- Ensure file is a valid PDF
- Try with a smaller test file first
- Check browser console (F12) for errors

### Analysis Takes a Long Time
- Large PDFs (>50MB) may take 30+ seconds
- Wait for analysis to complete
- Don't close the browser tab

### File Not Found After Upload
- Files are temporarily stored in `/tmp/epstein-pdf-analysis/`
- They may be cleaned up after system restarts
- Re-upload the PDF if needed

---
