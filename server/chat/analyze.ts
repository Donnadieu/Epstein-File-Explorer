import OpenAI from "openai";

const DEEPSEEK_MODEL = "deepseek-chat";
const MAX_CHUNK_CHARS = 24_000;

const DEEPSEEK_INPUT_COST_PER_M = 0.27;
const DEEPSEEK_OUTPUT_COST_PER_M = 1.10;

const ANALYSIS_PROMPT = `You are an expert analyst reviewing publicly released Epstein case documents from the US Department of Justice. Your job is to extract structured information from document text.

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

export interface AnalysisPersonMention {
  name: string;
  role: string;
  category: string;
  context: string;
  mentionCount: number;
}

export interface AnalysisConnection {
  person1: string;
  person2: string;
  relationshipType: string;
  description: string;
  strength: number;
}

export interface AnalysisEvent {
  date: string;
  title: string;
  description: string;
  category: string;
  significance: number;
  personsInvolved: string[];
}

export interface DocumentAnalysisResult {
  documentType: string;
  dateOriginal: string | null;
  summary: string;
  persons: AnalysisPersonMention[];
  connections: AnalysisConnection[];
  events: AnalysisEvent[];
  locations: string[];
  keyFacts: string[];
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  }
  return _client;
}

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

function calculateCostCents(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * DEEPSEEK_INPUT_COST_PER_M;
  const outputCost = (outputTokens / 1_000_000) * DEEPSEEK_OUTPUT_COST_PER_M;
  return Math.ceil((inputCost + outputCost) * 100) / 100;
}

export async function analyzeDocument(
  text: string,
  documentTitle: string,
): Promise<DocumentAnalysisResult> {
  const chunks = chunkText(text, MAX_CHUNK_CHARS);
  let totalInput = 0;
  let totalOutput = 0;

  const allPersons: AnalysisPersonMention[] = [];
  const allConnections: AnalysisConnection[] = [];
  const allEvents: AnalysisEvent[] = [];
  const allLocations: string[] = [];
  const allKeyFacts: string[] = [];
  let summary = "";
  let documentType = "other";
  let dateOriginal: string | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : "";

    const response = await getClient().chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        {
          role: "user",
          content: `Analyze this Epstein case document text${chunkLabel}. Document: ${documentTitle}\n\n---\n${chunk}`,
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    });

    const usage = response.usage;
    totalInput += usage?.prompt_tokens ?? 0;
    totalOutput += usage?.completion_tokens ?? 0;

    let content = response.choices[0]?.message?.content;
    if (!content) continue;

    content = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        continue;
      }
    }

    if (parsed.summary) summary += (summary ? " " : "") + parsed.summary;
    if (parsed.documentType && parsed.documentType !== "other") documentType = parsed.documentType;
    if (parsed.dateOriginal) dateOriginal = parsed.dateOriginal;

    for (const p of parsed.persons ?? []) {
      if (p.name && p.name.length > 2) allPersons.push(p);
    }
    for (const c of parsed.connections ?? []) allConnections.push(c);
    for (const e of parsed.events ?? []) allEvents.push(e);
    for (const l of parsed.locations ?? []) {
      if (!allLocations.includes(l)) allLocations.push(l);
    }
    for (const f of parsed.keyFacts ?? []) {
      if (!allKeyFacts.includes(f)) allKeyFacts.push(f);
    }

    if (chunks.length > 1 && i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return {
    documentType,
    dateOriginal,
    summary,
    persons: allPersons,
    connections: allConnections,
    events: allEvents,
    locations: allLocations,
    keyFacts: allKeyFacts,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costCents: calculateCostCents(totalInput, totalOutput),
  };
}
