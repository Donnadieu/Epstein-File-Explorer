import type { Person, ChatCitation, AIAnalysisListItem, AIAnalysisDocument } from "@shared/schema";
import { storage } from "../storage";
import { extractSearchQuery, buildTsQuery, type ExtractedQuery } from "./extractor";
import { isTypesenseConfigured, typesenseSearchPages } from "../typesense";
import { isR2Configured } from "../r2";

export interface RetrievalResult {
  contextText: string;
  citations: ChatCitation[];
  retrievedDocumentIds: number[];
}

const STOPWORDS = new Set([
  "the", "is", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "into", "through", "during", "before",
  "after", "above", "below", "between", "out", "off", "over", "under", "again",
  "further", "then", "once", "here", "there", "all", "each", "every", "both",
  "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "can", "will", "just", "should",
  "now", "also", "who", "what", "where", "when", "how", "why", "which", "whom",
  "did", "was", "were", "been", "being", "have", "has", "had", "having", "do",
  "does", "done", "doing", "would", "could", "might", "shall", "may", "must",
  "about", "up", "it", "its", "he", "she", "they", "them", "his", "her",
  "their", "we", "you", "me", "my", "your", "our", "this", "that", "these",
  "those", "am", "are", "if", "be", "because", "until", "while",
  "tell", "know", "any", "much", "many", "get", "got",
]);

const MAX_CONTEXT_CHARS = 20_000;

let personsCache: Person[] | null = null;

function extractKeywords(query: string): string[] {
  const tokens = query.toLowerCase().split(/[\s,.;:!?'"()\-/]+/);
  return tokens.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function matchesPersonName(keywords: string[], person: Person): boolean {
  const nameParts = person.name.toLowerCase().split(/\s+/);
  for (const keyword of keywords) {
    if (nameParts.some((part) => part.includes(keyword))) return true;
  }

  if (person.aliases) {
    for (const alias of person.aliases) {
      const aliasParts = alias.toLowerCase().split(/\s+/);
      for (const keyword of keywords) {
        if (aliasParts.some((part) => part.includes(keyword))) return true;
      }
    }
  }

  return false;
}

function matchesAnalysisItem(keywords: string[], item: AIAnalysisListItem): boolean {
  const searchable = `${item.summary} ${item.documentType} ${item.dataSet} ${item.fileName}`.toLowerCase();
  return keywords.some((kw) => searchable.includes(kw));
}

function truncateToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n...[truncated]";
}

async function loadPersons(): Promise<Person[]> {
  if (personsCache) return personsCache;
  personsCache = await storage.getPersons();
  return personsCache;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function matchesPersonByName(name: string, person: Person): boolean {
  const needle = name.toLowerCase();
  if (person.name.toLowerCase().includes(needle)) return true;
  if (person.aliases) {
    for (const alias of person.aliases) {
      if (alias.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

export async function retrieveContext(query: string): Promise<RetrievalResult> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return { contextText: "", citations: [], retrievedDocumentIds: [] };
  }

  // Run LLM extraction in parallel with loading persons and analysis list
  let extracted: ExtractedQuery | null = null;
  const [extractionResult, allPersons, analysisResult] = await Promise.all([
    extractSearchQuery(query).catch(() => null),
    loadPersons(),
    storage.getAIAnalysisList({ page: 1, limit: 50, search: keywords.join(" ") }),
  ]);
  extracted = extractionResult;
  const analysisList = analysisResult.data;

  // Build search terms: prefer LLM-extracted terms, fall back to keyword extraction
  const searchTerms =
    extracted && extracted.searchTerms.length > 0
      ? extracted.searchTerms
      : keywords;

  // Typesense-first for page search, PostgreSQL fallback
  let pageResults;
  const tsQuery = buildTsQuery(searchTerms);
  if (isTypesenseConfigured()) {
    try {
      pageResults = await typesenseSearchPages(tsQuery || query, 1, 20, { filterR2: isR2Configured() });
    } catch {
      // fall through to PostgreSQL
    }
  }
  if (!pageResults) {
    if (tsQuery) {
      pageResults = await storage.searchPages(tsQuery, 1, 20, true);
    } else {
      pageResults = await storage.searchPages(query, 1, 20);
    }
  }

  // Step 1: Find matched persons — prefer LLM-extracted names, fall back to keywords
  const matchedPersonIds = new Set<number>();

  if (extracted && extracted.personNames.length > 0) {
    for (const person of allPersons) {
      for (const name of extracted.personNames) {
        if (matchesPersonByName(name, person)) {
          matchedPersonIds.add(person.id);
          break;
        }
      }
    }
  } else {
    for (const person of allPersons) {
      if (matchesPersonName(keywords, person)) {
        matchedPersonIds.add(person.id);
      }
    }
  }

  // Step 2: Load full details for matched persons (up to 5)
  const personIds = Array.from(matchedPersonIds).slice(0, 5);
  const personDetails = await Promise.all(
    personIds.map((id) => storage.getPersonWithDetails(id)),
  );

  // Step 3: Find matching analysis files (DB already filtered by search, refine with keywords)
  const matchingAnalysisItems = analysisList.filter((item) =>
    matchesAnalysisItem(keywords, item),
  );
  const analysisFilesToLoad = matchingAnalysisItems.slice(0, 10);
  const analysisDocuments: AIAnalysisDocument[] = [];

  for (const item of analysisFilesToLoad) {
    const doc = await storage.getAIAnalysis(item.fileName);
    if (doc) {
      analysisDocuments.push(doc);
    }
  }

  // Step 4: Build context text and citations
  const sections: string[] = [];
  const citations: ChatCitation[] = [];
  const seenDocIds = new Set<number>();

  // Priority 1: Document summaries and key facts from AI analysis
  for (const analysis of analysisDocuments) {
    const parts: string[] = [];

    if (analysis.summary) {
      parts.push(`Summary: ${analysis.summary}`);
    }
    if (analysis.keyFacts && analysis.keyFacts.length > 0) {
      parts.push(`Key Facts:\n${analysis.keyFacts.map((f) => `- ${f}`).join("\n")}`);
    }
    if (analysis.persons && analysis.persons.length > 0) {
      const personNames = analysis.persons.map((p) => `${p.name} (${p.role ?? p.category ?? "mentioned"})`);
      parts.push(`Persons mentioned: ${personNames.join(", ")}`);
    }
    if (analysis.events && analysis.events.length > 0) {
      const eventLines = analysis.events.map((e) => `- ${e.date ? e.date + ": " : ""}${e.title}`);
      parts.push(`Events:\n${eventLines.join("\n")}`);
    }

    if (parts.length > 0) {
      const header = `[Analysis: ${analysis.fileName ?? "unknown"}] (${analysis.documentType ?? "document"})`;
      sections.push(`${header}\n${parts.join("\n")}`);
    }
  }

  // Priority 2: Full-text search page content
  for (const page of pageResults.results) {
    const plainText = stripHtmlTags(page.headline);
    if (!plainText.trim()) continue;

    const docLabel = `[Doc #${page.documentId}] ${page.title}`;
    sections.push(`${docLabel} (page ${page.pageNumber})\n${plainText}`);

    if (!seenDocIds.has(page.documentId)) {
      seenDocIds.add(page.documentId);
      citations.push({
        documentId: page.documentId,
        documentTitle: page.title,
        relevance: "full-text match",
      });
    }
  }

  // Priority 3: Person details and connections
  for (const detail of personDetails) {
    if (!detail) continue;

    const parts: string[] = [];
    parts.push(`Name: ${detail.name}`);
    if (detail.role) parts.push(`Role: ${detail.role}`);
    if (detail.description) parts.push(`Description: ${detail.description}`);
    if (detail.occupation) parts.push(`Occupation: ${detail.occupation}`);
    if (detail.nationality) parts.push(`Nationality: ${detail.nationality}`);

    if (detail.connections && detail.connections.length > 0) {
      const connLines = detail.connections.slice(0, 10).map(
        (c: any) => `- ${c.person?.name ?? "Unknown"}: ${c.connectionType}${c.description ? ` (${c.description})` : ""}`,
      );
      parts.push(`Connections:\n${connLines.join("\n")}`);
    }

    if (detail.documents && detail.documents.length > 0) {
      for (const doc of detail.documents.slice(0, 5)) {
        if (!seenDocIds.has(doc.id)) {
          seenDocIds.add(doc.id);
          citations.push({
            documentId: doc.id,
            documentTitle: doc.title,
            relevance: doc.mentionType ?? "linked",
          });
        }
      }
      const docLines = detail.documents.slice(0, 5).map(
        (d: any) => `- [Doc #${d.id}] ${d.title}${d.context ? `: ${d.context}` : ""}`,
      );
      parts.push(`Linked documents:\n${docLines.join("\n")}`);
    }

    sections.push(`[Person: ${detail.name}]\n${parts.join("\n")}`);
  }

  const contextText = truncateToLimit(sections.join("\n\n---\n\n"), MAX_CONTEXT_CHARS);
  return { contextText, citations, retrievedDocumentIds: Array.from(seenDocIds) };
}
