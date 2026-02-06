import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const AI_OUTPUT_DIR = path.join(DATA_DIR, "ai-analyzed");

const DEEPSEEK_MODEL = "deepseek/deepseek-chat-v3-0324";
const MAX_CHUNK_CHARS = 24000;
const MIN_TEXT_LENGTH = 200;

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

export interface AIAnalysisResult {
  fileName: string;
  dataSet: string;
  documentType: string;
  dateOriginal: string | null;
  summary: string;
  persons: AIPersonMention[];
  connections: AIConnection[];
  events: AIEvent[];
  locations: string[];
  keyFacts: string[];
  analyzedAt: string;
}

export interface AIPersonMention {
  name: string;
  role: string;
  category: "key figure" | "associate" | "victim" | "witness" | "legal" | "political" | "law enforcement" | "staff" | "other";
  context: string;
  mentionCount: number;
}

export interface AIConnection {
  person1: string;
  person2: string;
  relationshipType: string;
  description: string;
  strength: number;
}

export interface AIEvent {
  date: string;
  title: string;
  description: string;
  category: string;
  significance: number;
  personsInvolved: string[];
}

const SYSTEM_PROMPT = `You are an expert analyst reviewing publicly released Epstein case documents from the US Department of Justice. Your job is to extract structured information from document text.

For each document, identify:

1. PERSONS: Every named individual mentioned. For each person provide:
   - name: Full name as it appears (normalize to proper case)
   - role: Their role in context (e.g., "FBI Special Agent", "Defense Attorney", "Accused", "Witness")
   - category: One of: key figure, associate, victim, witness, legal, political, law enforcement, staff, other
   - context: 1-2 sentence summary of how they appear in this document
   - mentionCount: Approximate number of times mentioned

2. CONNECTIONS: Relationships between people mentioned in the document:
   - person1, person2: Names of the two people
   - relationshipType: Type like "employer-employee", "attorney-client", "co-conspirator", "social", "financial", "travel companion", "victim-perpetrator"
   - description: Brief description of the relationship as evidenced in this document
   - strength: 1-5 (1=mentioned together, 5=deeply connected)

3. EVENTS: Notable events, dates, or incidents referenced:
   - date: Date if mentioned (YYYY-MM-DD format, or YYYY-MM, or YYYY if only year known)
   - title: Short title for the event
   - description: What happened
   - category: One of: legal, travel, abuse, investigation, financial, political, death, arrest, testimony
   - significance: 1-5 (5=most significant)
   - personsInvolved: Names of people involved

4. DOCUMENT METADATA:
   - documentType: Best guess (grand jury transcript, deposition, FBI 302, court filing, search warrant, financial record, flight log, correspondence, police report, property record, other)
   - dateOriginal: Original date of the document if mentioned
   - summary: 2-3 sentence summary of the document's content and significance

5. LOCATIONS: Notable locations mentioned (addresses, properties, cities relevant to the case)

6. KEY FACTS: 3-5 most important factual claims or revelations from this document

IMPORTANT RULES:
- Only include REAL named individuals, not redacted names or "Jane Doe" type references
- Do NOT include organizational names as persons (FBI, DOJ, Grand Jury, etc.)
- Do NOT include locations, document references, or legal terms as persons
- If a name is clearly redacted (shown as blank or dots), note it in key facts but don't list as a person
- Focus on factual extraction, not interpretation
- If the text is too garbled or minimal to analyze, return empty arrays

Respond with valid JSON only, matching this structure:
{
  "documentType": "string",
  "dateOriginal": "string or null",
  "summary": "string",
  "persons": [...],
  "connections": [...],
  "events": [...],
  "locations": [...],
  "keyFacts": [...]
}`;

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const pages = text.split(/(?=Page \d+\s)/);

  let current = "";
  for (const page of pages) {
    if (current.length + page.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = page;
    } else {
      current += page;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

function mergeAnalyses(results: AIAnalysisResult[]): AIAnalysisResult {
  if (results.length === 1) return results[0];

  const merged: AIAnalysisResult = {
    ...results[0],
    persons: [],
    connections: [],
    events: [],
    locations: [],
    keyFacts: [],
  };

  const personMap = new Map<string, AIPersonMention>();
  const connSet = new Set<string>();
  const eventSet = new Set<string>();
  const locSet = new Set<string>();
  const factSet = new Set<string>();

  for (const r of results) {
    for (const p of r.persons) {
      const key = p.name.toLowerCase();
      if (personMap.has(key)) {
        const existing = personMap.get(key)!;
        existing.mentionCount += p.mentionCount;
        if (p.context.length > existing.context.length) {
          existing.context = p.context;
        }
      } else {
        personMap.set(key, { ...p });
      }
    }

    for (const c of r.connections) {
      const key = [c.person1, c.person2].sort().join("|") + "|" + c.relationshipType;
      if (!connSet.has(key)) {
        connSet.add(key);
        merged.connections.push(c);
      }
    }

    for (const e of r.events) {
      const key = e.date + "|" + e.title;
      if (!eventSet.has(key)) {
        eventSet.add(key);
        merged.events.push(e);
      }
    }

    for (const l of r.locations) {
      if (!locSet.has(l.toLowerCase())) {
        locSet.add(l.toLowerCase());
        merged.locations.push(l);
      }
    }

    for (const f of r.keyFacts) {
      if (!factSet.has(f.toLowerCase())) {
        factSet.add(f.toLowerCase());
        merged.keyFacts.push(f);
      }
    }
  }

  merged.persons = Array.from(personMap.values());
  merged.summary = results.map(r => r.summary).filter(Boolean).join(" ");

  return merged;
}

async function analyzeDocument(text: string, fileName: string, dataSet: string): Promise<AIAnalysisResult> {
  const chunks = chunkText(text, MAX_CHUNK_CHARS);
  console.log(`  Analyzing ${fileName} (${text.length} chars, ${chunks.length} chunk(s))...`);

  const chunkResults: AIAnalysisResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : "";

    try {
      const response = await openrouter.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Analyze this Epstein case document text${chunkLabel}. File: ${fileName}, Data Set: ${dataSet}\n\n---\n${chunk}`,
          },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      });

      let content = response.choices[0]?.message?.content;
      if (!content) {
        console.warn(`    No response for ${fileName}${chunkLabel}`);
        continue;
      }

      content = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          console.warn(`    Could not parse JSON from ${fileName}${chunkLabel}`);
          continue;
        }
      }

      chunkResults.push({
        fileName,
        dataSet,
        documentType: parsed.documentType || "other",
        dateOriginal: parsed.dateOriginal || null,
        summary: parsed.summary || "",
        persons: (parsed.persons || []).filter((p: any) => p.name && p.name.length > 2),
        connections: parsed.connections || [],
        events: parsed.events || [],
        locations: parsed.locations || [],
        keyFacts: parsed.keyFacts || [],
        analyzedAt: new Date().toISOString(),
      });

      if (chunks.length > 1 && i < chunks.length - 1) {
        await sleep(500);
      }
    } catch (error: any) {
      console.error(`    Error analyzing ${fileName}${chunkLabel}: ${error.message}`);
      if (error.message?.includes("429") || error.message?.includes("rate")) {
        console.log("    Rate limited, waiting 10s...");
        await sleep(10000);
        i--;
      }
    }
  }

  if (chunkResults.length === 0) {
    return {
      fileName,
      dataSet,
      documentType: "other",
      dateOriginal: null,
      summary: "Unable to analyze document",
      persons: [],
      connections: [],
      events: [],
      locations: [],
      keyFacts: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  return mergeAnalyses(chunkResults);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runAIAnalysis(options: {
  inputDir?: string;
  outputDir?: string;
  minTextLength?: number;
  limit?: number;
  skipExisting?: boolean;
  delayMs?: number;
} = {}): Promise<AIAnalysisResult[]> {
  const {
    inputDir = EXTRACTED_DIR,
    outputDir = AI_OUTPUT_DIR,
    minTextLength = MIN_TEXT_LENGTH,
    limit,
    skipExisting = true,
    delayMs = 1500,
  } = options;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log("\n=== AI Document Analyzer (DeepSeek) ===\n");
  console.log(`Model: ${DEEPSEEK_MODEL}`);
  console.log(`Input: ${inputDir}`);
  console.log(`Output: ${outputDir}`);

  const docs: { file: string; dataSet: string; text: string; chars: number }[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
          if (data.text && data.text.length >= minTextLength) {
            const dsMatch = fullPath.match(/ds(\d+)/);
            docs.push({
              file: data.fileName || entry.name.replace(".json", ""),
              dataSet: dsMatch ? dsMatch[1] : "unknown",
              text: data.text,
              chars: data.text.length,
            });
          }
        } catch { }
      }
    }
  }

  scanDir(inputDir);
  docs.sort((a, b) => a.chars - b.chars);

  const toProcess = limit ? docs.slice(0, limit) : docs;

  let skipped = 0;
  const docsToAnalyze = toProcess.filter(d => {
    if (skipExisting) {
      const outFile = path.join(outputDir, `${d.file}.json`);
      if (fs.existsSync(outFile)) {
        skipped++;
        return false;
      }
    }
    return true;
  });

  console.log(`\nFound ${docs.length} documents with ${minTextLength}+ chars of text`);
  console.log(`Processing: ${docsToAnalyze.length} (skipping ${skipped} already analyzed)`);

  const results: AIAnalysisResult[] = [];
  let processed = 0;
  let totalPersons = 0;
  let totalConnections = 0;
  let totalEvents = 0;

  for (const doc of docsToAnalyze) {
    try {
      const result = await analyzeDocument(doc.text, doc.file, doc.dataSet);

      const outFile = path.join(outputDir, `${doc.file}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

      results.push(result);
      processed++;
      totalPersons += result.persons.length;
      totalConnections += result.connections.length;
      totalEvents += result.events.length;

      const personNames = result.persons.map(p => p.name).slice(0, 5).join(", ");
      console.log(`  [${processed}/${docsToAnalyze.length}] ${doc.file}: ${result.persons.length} persons, ${result.connections.length} connections, ${result.events.length} events`);
      if (personNames) console.log(`    People: ${personNames}${result.persons.length > 5 ? "..." : ""}`);

      if (processed < docsToAnalyze.length) {
        await sleep(delayMs);
      }
    } catch (error: any) {
      console.error(`  Error processing ${doc.file}: ${error.message}`);
      if (error.message?.includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await sleep(30000);
      }
    }
  }

  console.log("\n=== AI Analysis Summary ===");
  console.log(`Documents analyzed: ${processed}`);
  console.log(`Total persons found: ${totalPersons}`);
  console.log(`Total connections found: ${totalConnections}`);
  console.log(`Total events found: ${totalEvents}`);
  console.log(`Output directory: ${outputDir}`);

  return results;
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof runAIAnalysis>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (args[i] === "--min-text" && args[i + 1]) {
      options.minTextLength = parseInt(args[++i], 10);
    } else if (args[i] === "--delay" && args[i + 1]) {
      options.delayMs = parseInt(args[++i], 10);
    } else if (args[i] === "--no-skip") {
      options.skipExisting = false;
    }
  }

  runAIAnalysis(options)
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
