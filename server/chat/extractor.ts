import { getClient, getModelConfig } from "./models";

export interface ExtractedQuery {
  searchTerms: string[];
  personNames: string[];
  documentType: string | null;
  intent:
    | "search"
    | "person_lookup"
    | "connection_query"
    | "timeline_query"
    | "count_query"
    | "general";
}

const EXTRACTION_PROMPT = `You extract search parameters from conversational questions about the Epstein case files archive.

Given a user question, return JSON with:
- searchTerms: array of keywords/phrases to search in document text (omit conversational filler like "how many times", "show me", "what do we know about")
- personNames: array of person names mentioned (e.g. ["Prince Andrew", "Ghislaine Maxwell"])
- documentType: if the user asks about a specific type, one of: "grand jury transcript", "deposition", "FBI 302", "court filing", "search warrant", "financial record", "flight log", "correspondence", "police report", "property record", "photograph", "email" — otherwise null
- intent: one of "search", "person_lookup", "connection_query", "timeline_query", "count_query", "general"

Return ONLY valid JSON, no markdown fences or extra text.`;

export async function extractSearchQuery(
  userMessage: string,
  modelId?: string,
): Promise<ExtractedQuery> {
  const client = getClient(modelId);
  const config = getModelConfig(modelId);

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 150,
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content ?? "";
  // Strip markdown fences if present (same pattern as analyze.ts)
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    searchTerms: Array.isArray(parsed.searchTerms) ? parsed.searchTerms : [],
    personNames: Array.isArray(parsed.personNames) ? parsed.personNames : [],
    documentType:
      typeof parsed.documentType === "string" ? parsed.documentType : null,
    intent: parsed.intent ?? "general",
  };
}

/**
 * Convert extracted search terms into a tsquery string.
 * Multi-word terms are ANDed internally, terms are ORed between each other.
 * e.g. ["flight log", "Virgin Islands"] → "flight & log | Virgin & Islands"
 */
export function buildTsQuery(terms: string[]): string {
  if (terms.length === 0) return "";

  const parts = terms.map((term) => {
    const words = term
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return words.join(" & ");
  });

  return parts.join(" | ");
}
