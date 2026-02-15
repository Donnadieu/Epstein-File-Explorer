# PDF Metadata Analysis Guide

## Overview

The PDF metadata extraction feature reveals hidden information embedded in PDF files that may contain sensitive details about document origins, creators, and processing history.

## What Metadata Can Reveal

### 1. **Creator Information** 🔍
Identifies who created or modified the document:
- **Author**: Person's name or organization
- **Creator Tool**: Software used (Adobe Acrobat, Microsoft Word, Photoshop, etc.)
- **Producer**: PDF generation software
- **Company**: Organization metadata

**Example Findings:**
```
xmp:CreatorTool: Adobe Acrobat Pro DC 2023.003.20244
dc:creator: John Doe, FBI FOIA Office
pdf:Producer: Adobe PDF Library 17.011
photoshop:AuthorsPosition: Special Agent
```

### 2. **Timestamps** 📅
Document history timeline:
- **Creation Date**: When original document was created
- **Modification Date**: Last edit timestamp
- **Metadata Date**: When metadata was last updated

**Why This Matters:**
- Can reveal if document was created before/after claimed dates
- Shows editing history and timeline gaps
- May contradict official narratives

### 3. **Software Fingerprints** 💻
Reveals processing chain:
- Scanning software
- OCR engines
- PDF manipulation tools
- Document management systems

**Example Chain:**
```
1. Scanned: Kofax VRS 5.1
2. OCR'd: ABBYY FineReader 14
3. Redacted: Adobe Acrobat Pro 2020
4. Processed: Nuance PDF Converter 8
```

### 4. **Document Management IDs** 🔐
Internal tracking information:
- **Document ID**: Unique identifier
- **Instance ID**: Version tracking
- **Original Document ID**: Source file reference
- **Version History**: Edit sequence

**Security Implications:**
- Can link documents across different releases
- Reveals internal document management systems
- May expose version control patterns

### 5. **Embedded Files** ⚠️
Hidden attachments within the PDF:
- Source documents
- Supporting evidence
- Redacted versions
- Audio/video files

**Red Flag:** If present, these files may contain:
- Unredacted versions
- Comments and annotations
- Revision history
- Original source materials

### 6. **EXIF Data** 📸
If PDF contains scanned images:
- Camera/scanner make and model
- GPS coordinates (location of scanning)
- Date/time photos taken
- Software used for image editing

## Metadata Categories Extracted

### File Properties
```json
{
  "filename": "document.pdf",
  "file_size_mb": 5.45,
  "created": "2026-02-14T16:53:39.966301",
  "modified": "2026-02-14T16:53:39.966301",
  "pdf_version": "1.5",
  "is_encrypted": false,
  "page_count": 122
}
```

### Document Info Dictionary
```json
{
  "Title": "Case File 2024-001",
  "Author": "FBI FOIA Office",
  "Subject": "Freedom of Information Act Request",
  "Creator": "Microsoft Word",
  "Producer": "Adobe Acrobat 11.0",
  "CreationDate": "D:20240115102345-05'00'",
  "ModDate": "D:20240315153020-04'00'"
}
```

### XMP Extended Metadata
Organized into categories:
- **Software & Tools**: All creator applications
- **Timestamps**: All date/time information
- **Document Management**: Version control IDs
- **Additional Properties**: Other XMP fields

### Security Settings
```json
{
  "encrypted": false,
  "encryption_method": null,
  "permissions": {
    "print": true,
    "modify": false,
    "extract": true,
    "annotate": false
  }
}
```

## Real-World Use Cases

### Case Study 1: DOJ Redaction Leaks
Documents released with metadata showing:
- Author: "redaction_team_contractor"
- CreatorTool: Adobe Acrobat Pro with specific version
- ModDate: 2 hours after official "complete" timestamp
→ Revealed rushed redaction process

### Case Study 2: Timeline Contradictions
Official claim: "Documents scanned in 2024"
Metadata reveals:
- CreationDate: 2018
- Scanner: Xerox WorkCentre 7845
- Location EXIF: Different building
→ Documents existed years earlier

### Case Study 3: Source Software Reveals Classification
Metadata pattern analysis:
- Classified docs: Always use specific Adobe version + plugin
- Unclassified docs: Use different software
- Pattern matching can identify originally classified documents

## Privacy & OPSEC Implications

### What Gets Left Behind
Even after careful redaction, metadata can reveal:
1. **Personnel**: Who handled the document
2. **Location**: Where processing occurred
3. **Tools**: Government vs contractor software
4. **Timeline**: True chronology of events
5. **Methods**: Document processing procedures

### How to Properly Clean Metadata

**For Releasers:**
```bash
# Remove ALL metadata (not just XMP)
exiftool -all= document.pdf

# Verify cleaning
exiftool document.pdf

# Flatten PDF structure
pdftk original.pdf output clean.pdf flatten
```

**For Investigators:**
```bash
# Extract before processing
exiftool -json document.pdf > metadata.json

# Compare multiple documents
find . -name "*.pdf" -exec exiftool {} \; > all_metadata.txt

# Look for patterns
grep -i "creator\|author\|producer" all_metadata.txt | sort | uniq -c
```

## Using the Web Interface

### Step-by-Step Analysis

1. **Upload Document**
   - Browse local files
   - Upload from computer
   - Or provide URL

2. **Click "Analyze PDF"**
   - Runs all 5 analysis types simultaneously
   - Includes metadata extraction

3. **Navigate to "Metadata" Tab**
   - Third tab in results panel
   - Color-coded sections:
     - 🔵 Blue: XMP Extended Metadata
     - 🟡 Yellow: Document Info (sensitive)
     - 🔴 Red: Embedded Files (high risk)

4. **Look for Red Flags**
   - Creator/Author names
   - Unusual software chains
   - Timestamp inconsistencies
   - Embedded files present
   - Document IDs linking files

5. **Export Findings**
   - JSON format for machine analysis
   - Copy individual fields
   - Screenshot for reports

## Automated Analysis Features

### Summary Statistics
Automatically calculated:
- `has_creator_info`: True if creator data present
- `has_dates`: True if timestamps found
- `has_xmp`: True if extended metadata exists
- `has_embedded_files`: True if attachments present
- `metadata_field_count`: Total fields extracted

### Visual Indicators
- **Yellow Warning**: Document Info may expose personnel
- **Blue Highlight**: XMP data shows processing chain
- **Red Alert**: Embedded files detected (investigate!)

## Advanced Techniques

### Cross-Document Analysis
Compare metadata across multiple files:
```javascript
// In browser console after analyzing multiple files
const creators = documents.map(d => d.metadata?.document_info?.Creator);
const unique = [...new Set(creators)];
console.log('Unique creators:', unique);
```

### Timeline Reconstruction
```python
# Using extracted JSON
import json
from datetime import datetime

# Load metadata
with open('metadata.json') as f:
    meta = json.load(f)

# Extract all dates
dates = {
    'created': meta['file_properties']['created'],
    'modified': meta['file_properties']['modified'],
    'doc_created': meta['document_info'].get('CreationDate'),
    'doc_modified': meta['document_info'].get('ModDate'),
}

# Look for discrepancies
for name, date in sorted(dates.items()):
    print(f"{name}: {date}")
```

### Software Fingerprinting
Identify document processing patterns:
```bash
# Extract all software mentions
jq '.xmp_metadata | to_entries[] | select(.key | contains("Creator") or contains("Producer") or contains("Tool")) | .value' *.json | sort | uniq -c
```

## Common Metadata Patterns

### Government Documents
```
Producer: Adobe PDF Library 11.0 (Nuance)
Creator: Nuance PDF Create 8 + Kofax plugin
Author: [Agency Name] FOIA Office
Keywords: FOIA, Public Release, Redacted
```

### Contractor Processing
```
Producer: Adobe Acrobat Pro DC 2023
Creator: Microsoft Office Word 2019
Author: [Individual Name]
Company: [Contractor Company]
```

### Hastily Redacted
```
CreationDate: 2024-01-15
ModDate: 2024-01-15 (same day)
Producer: Adobe Acrobat Pro (trial version)
# Red flag: Trial software + same-day processing
```

## Legal & Ethical Considerations

### What's Legal
✅ Analyzing publicly released documents
✅ Extracting metadata from FOIA releases
✅ Comparing public document metadata
✅ Publishing findings about public records

### Use Responsibly
⚠️ Don't dox individuals unnecessarily
⚠️ Consider context before publishing names
⚠️ Verify findings before making claims
⚠️ Don't use for harassment

## Integration with Other Tools

### With Redaction Analysis
Metadata + redaction audit = complete picture:
- Who created redactions (metadata)
- How they were created (audit tool)
- When they were applied (timestamps)
- Whether they worked (x-ray analysis)

### With Timeline Tools
Export metadata to timeline visualization:
```python
# Create timeline entry
timeline_event = {
    'date': metadata['document_info']['CreationDate'],
    'event': f"Document created by {metadata['document_info']['Author']}",
    'source': metadata['file_properties']['filename']
}
```

## Troubleshooting

### No Metadata Found
**Possible reasons:**
- Document was properly cleaned
- Scanned image-only PDF (no embedded metadata)
- Very old PDF (pre-XMP era)
- Metadata stripped by processing

**What to do:**
- Check "File Properties" section (always present)
- Look for patterns in filename
- Compare with other documents
- Check for embedded images with EXIF

### Raw XML Displayed
**Why it happens:**
- XMP format uses XML
- Some PDFs embed entire RDF schemas
- Standard namespace definitions included

**How to read:**
- Look for `rdf:Description` tags
- Fields with actual values (not definitions)
- Ignore namespace declarations

### Encoding Issues
**Characters like:** `D:20240115102345-05'00'`
- This is PDF date format
- Decodes to: 2024-01-15 10:23:45 EST
- The tool attempts to parse these automatically

## Bulk Analysis

For analyzing multiple documents:

```bash
# Extract metadata from all PDFs
for file in *.pdf; do
  curl -X POST http://localhost:5000/api/tools/analyze \
    -F "file=@$file" \
    | jq '.metadata' > "${file}.metadata.json"
done

# Find all documents with same creator
grep -r "Creator" *.metadata.json | cut -d: -f2 | sort | uniq -c
```

## Future Enhancements

Planned features:
- [ ] Metadata comparison across multiple files
- [ ] Automated pattern detection
- [ ] Timeline visualization
- [ ] Export to CSV/Excel
- [ ] Integration with database for historical tracking
- [ ] Machine learning for anomaly detection

## Resources

### Tools
- **ExifTool**: Command-line metadata viewer
- **PDFInfo**: PDF property inspector
- **Adobe Acrobat**: Professional metadata editor
- **Mat2**: Metadata removal tool

### Standards
- XMP Specification: https://www.adobe.com/devnet/xmp.html
- PDF 32000-1:2008 (PDF 1.7 spec)
- Dublin Core Metadata Initiative

### Research
- "Forensic Analysis of PDF Documents" - SANS Institute
- "Metadata in the Legal Context" - Electronic Discovery Institute
- "Privacy Implications of Document Metadata" - EFF

---

**Remember:** Metadata analysis is just one tool in document forensics. Combine with content analysis, redaction auditing, and contextual investigation for complete understanding.
