import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { z } from "zod";
import { getAIPriority } from "./media-classifier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const EXTRACTED_DIR = path.join(DATA_DIR, "extracted");
const AI_OUTPUT_DIR = path.join(DATA_DIR, "ai-analyzed");
const INVALID_AI_OUTPUT_SUBDIR = "invalid";

const DEEPSEEK_MODEL = "deepseek-chat";
const MAX_CHUNK_CHARS = 24000;
const MIN_TEXT_LENGTH = 200;

// DeepSeek direct pricing per million tokens
const DEEPSEEK_INPUT_COST_PER_M = 0.27; // cents per million input tokens
const DEEPSEEK_OUTPUT_COST_PER_M = 1.10; // cents per million output tokens

let _deepseek: OpenAI | null = null;
function getDeepSeek(): OpenAI {
  if (!_deepseek) {
    _deepseek = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  }
  return _deepseek;
}

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

export type AnalysisTier = 0 | 1;

export interface TieredAnalysisResult extends AIAnalysisResult {
  tier: AnalysisTier;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}

const PersonCategorySchema = z.enum([
  "key figure",
  "associate",
  "victim",
  "witness",
  "legal",
  "political",
  "law enforcement",
  "staff",
  "other",
]);

const AIResponsePersonSchema = z
  .object({
    name: z.string().trim().min(3),
    role: z.string().trim().min(1),
    category: PersonCategorySchema,
    context: z.string().trim().min(1),
    mentionCount: z.coerce.number().int().min(1),
  })
  .strict();

const AIResponseConnectionSchema = z
  .object({
    person1: z.string().trim().min(3),
    person2: z.string().trim().min(3),
    relationshipType: z.string().trim().min(1),
    description: z.string().trim().min(1),
    strength: z.coerce.number().int().min(1).max(5),
  })
  .strict();

const AIResponseEventSchema = z
  .object({
    date: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    category: z.string().trim().min(1),
    significance: z.coerce.number().int().min(1).max(5),
    personsInvolved: z.array(z.string().trim().min(3)),
  })
  .strict();

const AIResponseSchema = z
  .object({
    documentType: z.string().trim().min(1),
    dateOriginal: z.preprocess((value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }, z.union([z.string().trim().min(1), z.null()])),
    summary: z.string().trim().min(1),
    persons: z.array(AIResponsePersonSchema),
    connections: z.array(AIResponseConnectionSchema),
    events: z.array(AIResponseEventSchema),
    locations: z.array(z.string().trim().min(1)),
    keyFacts: z.array(z.string().trim().min(1)),
  })
  .strict();

type ValidatedAIResponse = z.infer<typeof AIResponseSchema>;

// --- Tier 0: Rule-based classification (FREE) ---

const DOCUMENT_TYPE_PATTERNS: [RegExp, string][] = [
  [/flight\s+log|manifest|passenger|aircraft|tail\s+number|teterboro/i, "flight log"],
  [/deposition|testimony|sworn|under\s+oath|direct\s+examination|cross.?examination/i, "deposition"],
  [/grand\s+jury|indictment|true\s+bill|presentment/i, "grand jury transcript"],
  [/search\s+warrant|inventory|seized|raid/i, "search warrant"],
  [/fbi|302|investigation|bureau|special\s+agent/i, "fbi report"],
  [/email|correspondence|from:\s*\S|to:\s*\S|subject:\s*\S/i, "email"],
  [/court|filing|motion|order|docket|plea/i, "court filing"],
  [/financial|bank|wire\s+transfer|account|transaction/i, "financial record"],
  [/contact|address\s+book|phone\s+number|rolodex/i, "contact list"],
  [/property|real\s+estate|island|little\s+st/i, "property record"],
  [/police|report|incident|complaint/i, "police report"],
];

const TIER0_KNOWN_PERSONS: [string, string, AIPersonMention["category"]][] = [
  ["jeffrey epstein", "Defendant/Subject", "key figure"],
  ["ghislaine maxwell", "Co-conspirator/Associate", "key figure"],
  ["virginia giuffre", "Victim/Plaintiff", "victim"],
  ["virginia roberts", "Victim/Plaintiff", "victim"],
  ["prince andrew", "Associate/Named Individual", "political"],
  ["alan dershowitz", "Defense Attorney", "legal"],
  ["jean-luc brunel", "Associate/Recruiter", "associate"],
  ["sarah kellen", "Assistant/Associate", "staff"],
  ["les wexner", "Financial Associate", "associate"],
  ["alexander acosta", "Prosecutor (NPA)", "legal"],
  ["bill clinton", "Associate/Named Individual", "political"],
  ["donald trump", "Associate/Named Individual", "political"],
  ["nadia marcinkova", "Victim/Associate", "victim"],
  ["johanna sjoberg", "Victim/Witness", "victim"],
  ["adriana ross", "Associate", "associate"],
  ["lesley groff", "Executive Assistant", "staff"],
  ["bill gates", "Associate", "associate"],
  ["bill richardson", "Associate/Named Individual", "political"],
  ["george mitchell", "Associate/Named Individual", "political"],
  ["ehud barak", "Associate/Named Individual", "political"],
  ["leon black", "Financial Associate", "associate"],
  ["glenn dubin", "Financial Associate", "associate"],
  ["eva andersson-dubin", "Associate", "associate"],
  ["larry summers", "Associate/Named Individual", "political"],
  ["naomi campbell", "Associate", "associate"],
  ["kevin spacey", "Associate", "associate"],
  ["david copperfield", "Associate", "associate"],
  ["woody allen", "Associate", "associate"],
  ["reid hoffman", "Associate", "associate"],
  ["sergey brin", "Associate", "associate"],
  ["richard branson", "Associate", "associate"],
  ["peter mandelson", "Associate/Named Individual", "political"],
  ["sarah ferguson", "Associate", "associate"],
  ["steve bannon", "Associate/Named Individual", "political"],
  ["peter attia", "Associate", "associate"],
  ["marvin minsky", "Associate/Academic", "associate"],
  ["lawrence krauss", "Associate/Academic", "associate"],
  ["stephen hawking", "Associate/Academic", "associate"],
  ["leon botstein", "Associate/Academic", "associate"],
  ["katie couric", "Associate", "associate"],
  ["martha stewart", "Associate", "associate"],
  ["chris tucker", "Associate", "associate"],
];

const DATE_PATTERN = /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi;
const LOCATION_PATTERNS = [
  /(?:Palm Beach|New York|Manhattan|Little St\.? James|U\.?S\.? Virgin Islands|Zorro Ranch|New Mexico|Teterboro|London|Paris)/gi,
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function properCase(str: string): string {
  return str.split(/\s+/).map(w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
}

function inferDocumentTypeFromText(text: string): string {
  for (const [pattern, docType] of DOCUMENT_TYPE_PATTERNS) {
    if (pattern.test(text)) return docType;
  }
  return "government record";
}

function inferDateFromText(text: string): string | null {
  const match = text.match(DATE_PATTERN);
  return match ? match[0] : null;
}

function extractLocationsFromText(text: string): string[] {
  const locs = new Set<string>();
  for (const pattern of LOCATION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = regex.exec(text)) !== null) {
      locs.add(m[0]);
    }
  }
  return Array.from(locs);
}

export function analyzeDocumentTier0(text: string, fileName: string, dataSet: string): TieredAnalysisResult {
  const persons: AIPersonMention[] = [];

  for (const [name, role, category] of TIER0_KNOWN_PERSONS) {
    const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, "gi");
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      const contextMatch = text.match(new RegExp(`.{0,80}${escapeRegex(name)}.{0,80}`, "i"));
      persons.push({
        name: properCase(name),
        role,
        category,
        context: contextMatch ? contextMatch[0].trim() : `Mentioned in ${fileName}`,
        mentionCount: matches.length,
      });
    }
  }

  const documentType = inferDocumentTypeFromText(text);
  const dateOriginal = inferDateFromText(text);
  const locations = extractLocationsFromText(text);

  const firstChunk = text.slice(0, 500).replace(/\s+/g, " ").trim();
  const summary = persons.length > 0
    ? `${documentType} from Data Set ${dataSet} mentioning ${persons.slice(0, 3).map(p => p.name).join(", ")}${persons.length > 3 ? " and others" : ""}. ${firstChunk.slice(0, 150)}...`
    : `${documentType} from Data Set ${dataSet}. ${firstChunk.slice(0, 200)}...`;

  return {
    fileName,
    dataSet,
    documentType,
    dateOriginal,
    summary,
    persons,
    connections: [],
    events: [],
    locations,
    keyFacts: [],
    analyzedAt: new Date().toISOString(),
    tier: 0,
    costCents: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

// --- Tier 1: DeepSeek AI analysis ---

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

function extractJSONFromText(content: string): string | null {
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  return content.slice(firstBrace, lastBrace + 1);
}

type ParseAndValidateResult =
  | { ok: true; data: ValidatedAIResponse }
  | { ok: false; reason: string };

function sanitizeForFilename(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function persistInvalidAIResponse(
  invalidOutputDir: string | undefined,
  params: {
    fileName: string;
    dataSet: string;
    chunkIndex: number;
    chunksTotal: number;
    reason: string;
    rawContent: string;
  },
): void {
  if (!invalidOutputDir) return;

  try {
    fs.mkdirSync(invalidOutputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = sanitizeForFilename(params.fileName);
    const outPath = path.join(
      invalidOutputDir,
      `${stamp}_${base}_chunk-${params.chunkIndex + 1}-of-${params.chunksTotal}.json`,
    );

    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          fileName: params.fileName,
          dataSet: params.dataSet,
          chunkIndex: params.chunkIndex,
          chunksTotal: params.chunksTotal,
          reason: params.reason,
          capturedAt: new Date().toISOString(),
          rawContent: params.rawContent,
        },
        null,
        2,
      ),
    );
  } catch (error: any) {
    console.warn(`    Failed to persist invalid AI response: ${error.message}`);
  }
}

function parseAndValidateAIResponse(
  content: string,
  fileName: string,
  chunkLabel: string,
): ParseAndValidateResult {
  const cleaned = content
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  const parseCandidates = [cleaned];
  const extracted = extractJSONFromText(cleaned);
  if (extracted && extracted !== cleaned) {
    parseCandidates.push(extracted);
  }

  let lastSchemaError: z.ZodError | null = null;
  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const validated = AIResponseSchema.safeParse(parsed);
      if (validated.success) {
        return { ok: true, data: validated.data };
      }
      lastSchemaError = validated.error;
    } catch {
      // Try next parse candidate
    }
  }

  if (lastSchemaError) {
    const details = lastSchemaError.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    console.warn(
      `    Invalid AI JSON schema for ${fileName}${chunkLabel}: ${details}`,
    );
    return { ok: false, reason: `Schema validation failed: ${details}` };
  }

  console.warn(`    Could not parse JSON from ${fileName}${chunkLabel}`);
  return { ok: false, reason: "JSON parsing failed (no valid object found)" };
}

function calculateCostCents(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * DEEPSEEK_INPUT_COST_PER_M;
  const outputCost = (outputTokens / 1_000_000) * DEEPSEEK_OUTPUT_COST_PER_M;
  return Math.ceil((inputCost + outputCost) * 100) / 100; // round to nearest 0.01 cent
}

interface AnalyzeChunkResult {
  analysis: AIAnalysisResult;
  inputTokens: number;
  outputTokens: number;
}

async function analyzeDocumentWithTokens(
  text: string,
  fileName: string,
  dataSet: string,
  options?: { invalidOutputDir?: string },
): Promise<{ result: AIAnalysisResult; inputTokens: number; outputTokens: number; invalidChunks: number }> {
  const chunks = chunkText(text, MAX_CHUNK_CHARS);
  console.log(`  Analyzing ${fileName} (${text.length} chars, ${chunks.length} chunk(s))...`);
  const invalidOutputDir = options?.invalidOutputDir;

  const chunkResults: AnalyzeChunkResult[] = [];
  let invalidChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : "";

    try {
      const response = await getDeepSeek().chat.completions.create({
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

      const usage = response.usage;
      const inTok = usage?.prompt_tokens ?? 0;
      const outTok = usage?.completion_tokens ?? 0;

      const parsed = parseAndValidateAIResponse(content, fileName, chunkLabel);
      if (!parsed.ok) {
        invalidChunks++;
        persistInvalidAIResponse(invalidOutputDir, {
          fileName,
          dataSet,
          chunkIndex: i,
          chunksTotal: chunks.length,
          reason: parsed.reason,
          rawContent: content,
        });
        continue;
      }

      chunkResults.push({
        analysis: {
          fileName,
          dataSet,
          documentType: parsed.data.documentType,
          dateOriginal: parsed.data.dateOriginal,
          summary: parsed.data.summary,
          persons: parsed.data.persons,
          connections: parsed.data.connections,
          events: parsed.data.events,
          locations: parsed.data.locations,
          keyFacts: parsed.data.keyFacts,
          analyzedAt: new Date().toISOString(),
        },
        inputTokens: inTok,
        outputTokens: outTok,
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
      result: {
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
      },
      inputTokens: 0,
      outputTokens: 0,
      invalidChunks,
    };
  }

  const totalInput = chunkResults.reduce((sum, c) => sum + c.inputTokens, 0);
  const totalOutput = chunkResults.reduce((sum, c) => sum + c.outputTokens, 0);
  const merged = mergeAnalyses(chunkResults.map(c => c.analysis));

  return {
    result: merged,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    invalidChunks,
  };
}

export async function analyzeDocumentTiered(
  text: string,
  fileName: string,
  dataSet: string,
  tier: AnalysisTier,
): Promise<TieredAnalysisResult> {
  if (tier === 0) {
    return analyzeDocumentTier0(text, fileName, dataSet);
  }

  // Tier 1: DeepSeek API
  const { result, inputTokens, outputTokens } = await analyzeDocumentWithTokens(text, fileName, dataSet);
  const costCents = calculateCostCents(inputTokens, outputTokens);

  return {
    ...result,
    tier: 1,
    costCents,
    inputTokens,
    outputTokens,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Legacy API: backward-compatible runAIAnalysis ---

export async function runAIAnalysis(options: {
  inputDir?: string;
  outputDir?: string;
  minTextLength?: number;
  limit?: number;
  skipExisting?: boolean;
  delayMs?: number;
  minPriority?: number;
  budget?: number;
  dryRun?: boolean;
} = {}): Promise<AIAnalysisResult[]> {
  const {
    inputDir = EXTRACTED_DIR,
    outputDir = AI_OUTPUT_DIR,
    minTextLength = MIN_TEXT_LENGTH,
    limit,
    skipExisting = true,
    delayMs = 1500,
    minPriority = 1,
    budget,
    dryRun = false,
  } = options;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const invalidOutputDir = path.join(outputDir, INVALID_AI_OUTPUT_SUBDIR);

  console.log("\n=== AI Document Analyzer (DeepSeek) ===\n");
  console.log(`Model: ${DEEPSEEK_MODEL}`);
  console.log(`Input: ${inputDir}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Invalid AI responses: ${invalidOutputDir}`);
  console.log(`Min priority: ${minPriority}${budget ? `, Budget: ${budget} cents ($${(budget / 100).toFixed(2)})` : ""}`);
  if (dryRun) console.log(`*** DRY RUN — no API calls will be made ***`);

  // Phase 1: Scan for file paths only (no text loaded) to avoid OOM
  const filePaths: { fullPath: string; file: string; dataSet: string }[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const dsMatch = fullPath.match(/ds(\d+)/);
        filePaths.push({
          fullPath,
          file: entry.name.replace(".json", ""),
          dataSet: dsMatch ? dsMatch[1] : "unknown",
        });
      }
    }
  }

  scanDir(inputDir);
  console.log(`\nFound ${filePaths.length} extracted files on disk`);

  // Phase 2: Filter out already-analyzed files
  // Pre-scan output directory into a Set for O(1) lookups (avoids N existsSync calls)
  const existingOutputs = new Set<string>();
  if (fs.existsSync(outputDir)) {
    for (const f of fs.readdirSync(outputDir)) {
      if (f.endsWith(".json")) {
        existingOutputs.add(f.replace(/\.json$/, ""));
      }
    }
  }

  let skipped = 0;
  const candidates = filePaths.filter(f => {
    if (skipExisting) {
      // Check both old naming (fileName.pdf → "X.pdf") and new naming (entry.file → "X")
      if (existingOutputs.has(f.file) || existingOutputs.has(f.file + ".pdf")) {
        skipped++;
        return false;
      }
    }
    return true;
  });

  const toProcess = limit ? candidates.slice(0, limit) : candidates;
  console.log(`To analyze: ${toProcess.length} (skipping ${skipped} already analyzed, limit: ${limit ?? "none"})`);

  // --- Dry run: estimate cost and exit without API calls ---
  if (dryRun) {
    let totalChars = 0;
    let totalDocs = 0;
    let skippedShortDry = 0;
    let skippedPriorityDry = 0;

    for (const entry of toProcess) {
      try {
        const data = JSON.parse(fs.readFileSync(entry.fullPath, "utf-8"));
        if (!data.text || data.text.length < minTextLength) {
          skippedShortDry++;
          continue;
        }
        const fileSizeBytes = data.fileSizeBytes ?? null;
        const mediaType = data.fileType?.toLowerCase().includes("pdf") ? "pdf" as const : "pdf" as const;
        const priority = getAIPriority(entry.dataSet, fileSizeBytes, mediaType);
        if (priority < minPriority) {
          skippedPriorityDry++;
          continue;
        }
        totalChars += data.text.length;
        totalDocs++;
      } catch {
        /* skip unreadable */
      }
    }

    // Rough token estimate: ~4 chars per token for English text
    const estimatedInputTokens = totalChars / 4;
    // Assume ~500 output tokens per document (structured JSON response)
    const estimatedOutputTokens = totalDocs * 500;
    const estimatedCostCents =
      (estimatedInputTokens / 1_000_000) * DEEPSEEK_INPUT_COST_PER_M +
      (estimatedOutputTokens / 1_000_000) * DEEPSEEK_OUTPUT_COST_PER_M;

    console.log("\n=== DRY RUN Summary ===");
    console.log(`Documents that would be analyzed: ${totalDocs}`);
    console.log(`Skipped (short text): ${skippedShortDry}`);
    console.log(`Skipped (low priority): ${skippedPriorityDry}`);
    console.log(`Total text chars: ${totalChars.toLocaleString()}`);
    console.log(`Estimated input tokens: ~${Math.round(estimatedInputTokens).toLocaleString()}`);
    console.log(`Estimated output tokens: ~${Math.round(estimatedOutputTokens).toLocaleString()}`);
    console.log(`Estimated cost: ~${estimatedCostCents.toFixed(2)} cents ($${(estimatedCostCents / 100).toFixed(4)})`);
    if (budget) {
      console.log(`Budget: ${budget} cents — ${estimatedCostCents <= budget ? "within budget" : "EXCEEDS budget by " + (estimatedCostCents - budget).toFixed(2) + " cents"}`);
    }
    console.log(`\nRe-run without --dry-run to execute.`);
    return [];
  }

  // Phase 3: Process one at a time, loading text lazily
  const results: AIAnalysisResult[] = [];
  let processed = 0;
  let totalPersons = 0;
  let totalConnections = 0;
  let totalEvents = 0;
  let skippedShort = 0;
  let skippedPriority = 0;
  let totalCostCents = 0;
  let invalidChunks = 0;

  for (const entry of toProcess) {
    // Budget check
    if (budget && totalCostCents >= budget) {
      console.log(`\n  Budget cap reached: ${totalCostCents.toFixed(2)} / ${budget} cents`);
      break;
    }

    try {
      const data = JSON.parse(fs.readFileSync(entry.fullPath, "utf-8"));
      const fileName = data.fileName || entry.file;
      if (!data.text || data.text.length < minTextLength) {
        skippedShort++;
        continue;
      }

      // Priority check — compute from data set and file size
      const fileSizeBytes = data.fileSizeBytes ?? null;
      const mediaType = data.fileType?.toLowerCase().includes("pdf") ? "pdf" as const : "pdf" as const;
      const priority = getAIPriority(entry.dataSet, fileSizeBytes, mediaType);
      if (priority < minPriority) {
        skippedPriority++;
        continue;
      }

      const {
        result,
        inputTokens,
        outputTokens,
        invalidChunks: documentInvalidChunks,
      } = await analyzeDocumentWithTokens(
        data.text,
        fileName,
        entry.dataSet,
        { invalidOutputDir },
      );
      invalidChunks += documentInvalidChunks;
      const costCents = (inputTokens / 1_000_000) * DEEPSEEK_INPUT_COST_PER_M + (outputTokens / 1_000_000) * DEEPSEEK_OUTPUT_COST_PER_M;
      totalCostCents += costCents;

      const outFile = path.join(outputDir, `${entry.file}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

      results.push(result);
      processed++;
      totalPersons += result.persons.length;
      totalConnections += result.connections.length;
      totalEvents += result.events.length;

      const personNames = result.persons.map(p => p.name).slice(0, 5).join(", ");
      console.log(`  [${processed}/${toProcess.length}] ${fileName} (pri ${priority}): ${result.persons.length} persons, ${result.connections.length} connections, ${result.events.length} events [${costCents.toFixed(3)}¢, total: ${totalCostCents.toFixed(2)}¢]`);
      if (personNames) console.log(`    People: ${personNames}${result.persons.length > 5 ? "..." : ""}`);

      if (processed < toProcess.length) {
        await sleep(delayMs);
      }
    } catch (error: any) {
      console.error(`  Error processing ${entry.file}: ${error.message}`);
      if (error.message?.includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await sleep(30000);
      }
    }
  }

  if (skippedShort > 0) console.log(`Skipped ${skippedShort} files with < ${minTextLength} chars of text`);
  if (skippedPriority > 0) console.log(`Skipped ${skippedPriority} files below priority ${minPriority}`);
  if (invalidChunks > 0) console.log(`Captured ${invalidChunks} invalid AI chunk responses in ${invalidOutputDir}`);

  console.log("\n=== AI Analysis Summary ===");
  console.log(`Documents analyzed: ${processed}`);
  console.log(`Total persons found: ${totalPersons}`);
  console.log(`Total connections found: ${totalConnections}`);
  console.log(`Total events found: ${totalEvents}`);
  console.log(`Total cost: ${totalCostCents.toFixed(2)} cents ($${(totalCostCents / 100).toFixed(4)})`);
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
    } else if (args[i] === "--priority" && args[i + 1]) {
      options.minPriority = parseInt(args[++i], 10);
    } else if (args[i] === "--budget" && args[i + 1]) {
      options.budget = parseInt(args[++i], 10);
    } else if (args[i] === "--no-skip") {
      options.skipExisting = false;
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    }
  }

  runAIAnalysis(options)
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
