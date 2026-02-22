import Typesense from "typesense";
import Client from "typesense/lib/Typesense/Client";
import type { CollectionCreateSchema } from "typesense/lib/Typesense/Collections";
import type { SearchResponseHit } from "typesense/lib/Typesense/Documents";
import { isR2Configured } from "./r2";

// --- Client ---

let client: Client | null = null;

export function isTypesenseConfigured(): boolean {
  return !!(
    process.env.TYPESENSE_HOST &&
    (process.env.TYPESENSE_SEARCH_API_KEY || process.env.TYPESENSE_API_KEY)
  );
}

export function getTypesenseClient(): Client | null {
  if (client) return client;

  const host = process.env.TYPESENSE_HOST;
  const apiKey =
    process.env.TYPESENSE_SEARCH_API_KEY || process.env.TYPESENSE_API_KEY;

  if (!host || !apiKey) return null;

  client = new Typesense.Client({
    nodes: [
      {
        host,
        port: parseInt(process.env.TYPESENSE_PORT || "8108"),
        protocol: process.env.TYPESENSE_PROTOCOL || "http",
      },
    ],
    apiKey,
    connectionTimeoutSeconds: 5,
    retryIntervalSeconds: 0.1,
    numRetries: 3,
  });

  return client;
}

// --- Collection Schemas ---

export const COLLECTION_NAME = "document_pages";

export const COLLECTION_SCHEMA: CollectionCreateSchema = {
  name: COLLECTION_NAME,
  fields: [
    { name: "pg_id", type: "int32", index: false },
    { name: "document_id", type: "int32", facet: true },
    { name: "page_number", type: "int32", sort: true },
    { name: "content", type: "string" },
    { name: "title", type: "string" },
    { name: "document_type", type: "string", facet: true },
    { name: "data_set", type: "string", facet: true, optional: true },
    { name: "page_type", type: "string", facet: true, optional: true },
    { name: "is_viewable", type: "bool" },
  ],
  default_sorting_field: "page_number",
  token_separators: ["-", "_", "."],
};

export const PERSONS_COLLECTION = "persons";

export const PERSONS_SCHEMA: CollectionCreateSchema = {
  name: PERSONS_COLLECTION,
  fields: [
    { name: "pg_id", type: "int32", index: false },
    { name: "name", type: "string" },
    { name: "aliases", type: "string[]", optional: true },
    { name: "role", type: "string", facet: true },
    { name: "description", type: "string" },
    { name: "occupation", type: "string", optional: true },
    { name: "category", type: "string", facet: true },
  ],
  token_separators: ["-", "_", "."],
};

// --- Synonym Definitions ---

/** Static synonyms applied to the document_pages collection */
export const DOCUMENT_PAGE_SYNONYMS = [
  {
    id: "lolita-express",
    synonyms: ["Lolita Express", "N908JE"],
  },
  {
    id: "little-st-james",
    synonyms: ["Little St. James", "LSJ", "the island", "private island"],
  },
  {
    id: "virginia-roberts-giuffre",
    synonyms: ["Virginia Roberts", "Virginia Giuffre", "Virginia Roberts Giuffre"],
  },
  {
    id: "npa",
    synonyms: ["NPA", "Non-Prosecution Agreement"],
  },
];

/** Static synonyms applied to the persons collection */
export const PERSONS_SYNONYMS = [
  {
    id: "virginia-roberts-giuffre",
    synonyms: ["Virginia Roberts", "Virginia Giuffre", "Virginia Roberts Giuffre"],
  },
  {
    id: "npa",
    synonyms: ["NPA", "Non-Prosecution Agreement"],
  },
];

/**
 * Upsert multi-way synonyms to a Typesense collection.
 */
export async function upsertSynonyms(
  tsClient: Client,
  collectionName: string,
  synonyms: { id: string; synonyms: string[] }[],
): Promise<void> {
  for (const syn of synonyms) {
    await tsClient.collections(collectionName).synonyms().upsert(syn.id, {
      synonyms: syn.synonyms,
    });
  }
}

/**
 * Build one-way synonyms from person aliases.
 * Each alias maps to the canonical person name so searching by alias finds the person.
 */
export function buildAliasSynonyms(
  persons: Array<{ id: number; name: string; aliases: string[] | null }>,
): { id: string; root: string; synonyms: string[] }[] {
  const result: { id: string; root: string; synonyms: string[] }[] = [];
  for (const person of persons) {
    const aliases = person.aliases?.filter(
      (a) => a.toLowerCase() !== person.name.toLowerCase(),
    );
    if (!aliases || aliases.length === 0) continue;
    result.push({
      id: `person-alias-${person.id}`,
      root: person.name,
      synonyms: aliases,
    });
  }
  return result;
}

/**
 * Upsert one-way synonyms (alias → canonical name) to a Typesense collection.
 */
export async function upsertOneWaySynonyms(
  tsClient: Client,
  collectionName: string,
  synonyms: { id: string; root: string; synonyms: string[] }[],
): Promise<void> {
  for (const syn of synonyms) {
    await tsClient.collections(collectionName).synonyms().upsert(syn.id, {
      root: syn.root,
      synonyms: syn.synonyms,
    });
  }
}

// --- Types ---

export interface TypesensePageResult {
  documentId: number;
  title: string;
  documentType: string;
  dataSet: string | null;
  pageNumber: number;
  headline: string;
  pageType: string | null;
}

export interface TypesenseSearchResponse {
  results: TypesensePageResult[];
  total: number;
  page: number;
  totalPages: number;
  facets?: {
    documentTypes: { value: string; count: number }[];
    dataSets: { value: string; count: number }[];
  };
}

export interface TypesensePersonResult {
  pgId: number;
  name: string;
  aliases: string[];
  role: string;
  description: string;
  occupation: string | null;
  category: string;
}

// --- Document shape stored in Typesense ---

interface TSDocument {
  id: string;
  pg_id: number;
  document_id: number;
  page_number: number;
  content: string;
  title: string;
  document_type: string;
  data_set?: string;
  page_type?: string;
  is_viewable: boolean;
}

// --- Search Functions ---

function buildFilterBy(options?: {
  filterR2?: boolean;
  documentType?: string;
  dataSet?: string;
}): string | undefined {
  const parts: string[] = [];

  if (options?.filterR2) {
    parts.push("is_viewable:true");
  }
  if (options?.documentType) {
    parts.push(`document_type:=\`${options.documentType}\``);
  }
  if (options?.dataSet) {
    parts.push(`data_set:=\`${options.dataSet}\``);
  }

  return parts.length > 0 ? parts.join(" && ") : undefined;
}

function hitToResult(hit: SearchResponseHit<TSDocument>): TypesensePageResult {
  const doc = hit.document;
  const highlights = hit.highlights ?? [];
  const contentHighlight = highlights.find(
    (h) => h.field === "content",
  );

  const snippet = contentHighlight?.snippets
    ? contentHighlight.snippets.join(" &hellip; ")
    : (doc.content || "").slice(0, 200);

  return {
    documentId: doc.document_id,
    title: doc.title,
    documentType: doc.document_type,
    dataSet: doc.data_set ?? null,
    pageNumber: doc.page_number,
    headline: snippet,
    pageType: doc.page_type ?? null,
  };
}

function extractFacets(
  facetCounts: Array<{ field_name: string; counts: Array<{ value: string; count: number }> }>,
): TypesenseSearchResponse["facets"] {
  const byField = new Map<string, { value: string; count: number }[]>();
  for (const facet of facetCounts) {
    byField.set(
      facet.field_name,
      (facet.counts ?? []).map((c) => ({ value: c.value, count: c.count })),
    );
  }
  return {
    documentTypes: byField.get("document_type") ?? [],
    dataSets: byField.get("data_set") ?? [],
  };
}

/**
 * Full paginated search — used by /api/search/pages.
 */
export async function typesenseSearchPages(
  query: string,
  page: number,
  limit: number,
  options?: { filterR2?: boolean; documentType?: string; dataSet?: string },
): Promise<TypesenseSearchResponse> {
  const ts = getTypesenseClient();
  if (!ts) throw new Error("Typesense not configured");

  const filterBy = buildFilterBy(options);

  const result = await ts
    .collections<TSDocument>(COLLECTION_NAME)
    .documents()
    .search({
      q: query,
      query_by: "content,title",
      query_by_weights: "2,1",
      highlight_fields: "content",
      highlight_start_tag: "<mark>",
      highlight_end_tag: "</mark>",
      snippet_threshold: 40,
      per_page: limit,
      page,
      filter_by: filterBy,
      facet_by: "document_type,data_set",
      max_facet_values: 50,
      num_typos: 2,
      typo_tokens_threshold: 2,
      drop_tokens_threshold: 1,
    });

  return {
    results: (result.hits ?? []).map(hitToResult),
    total: result.found ?? 0,
    page,
    totalPages: Math.ceil((result.found ?? 0) / limit),
    facets: extractFacets((result.facet_counts as any) ?? []),
  };
}

/**
 * Lightweight instant search — used by type-ahead /api/search/instant.
 * Returns minimal results quickly.
 */
export async function typesenseSearchInstant(
  query: string,
  limit: number,
): Promise<TypesenseSearchResponse> {
  const ts = getTypesenseClient();
  if (!ts) throw new Error("Typesense not configured");

  const filterBy = isR2Configured() ? "is_viewable:true" : undefined;

  const result = await ts
    .collections<TSDocument>(COLLECTION_NAME)
    .documents()
    .search({
      q: query,
      query_by: "content,title",
      query_by_weights: "2,1",
      highlight_fields: "content",
      highlight_start_tag: "<mark>",
      highlight_end_tag: "</mark>",
      snippet_threshold: 30,
      per_page: limit,
      page: 1,
      filter_by: filterBy,
      num_typos: 2,
      prefix: true,
    });

  return {
    results: (result.hits ?? []).map(hitToResult),
    total: result.found ?? 0,
    page: 1,
    totalPages: Math.ceil((result.found ?? 0) / limit),
  };
}

/**
 * Multi-search for /api/search endpoint — groups results by document_id
 * to find unique documents matching the query.
 */
export async function typesenseDocumentSearch(
  query: string,
  limit: number = 20,
): Promise<TypesensePageResult[]> {
  const ts = getTypesenseClient();
  if (!ts) throw new Error("Typesense not configured");

  const filterBy = isR2Configured() ? "is_viewable:true" : undefined;

  const result = await ts
    .collections<TSDocument>(COLLECTION_NAME)
    .documents()
    .search({
      q: query,
      query_by: "content,title",
      query_by_weights: "2,1",
      highlight_fields: "content",
      highlight_start_tag: "<mark>",
      highlight_end_tag: "</mark>",
      per_page: limit,
      page: 1,
      filter_by: filterBy,
      group_by: "document_id",
      group_limit: 1,
      num_typos: 2,
    });

  // Grouped results come in grouped_hits
  const grouped = (result as any).grouped_hits ?? [];
  return grouped.map((g: any) => {
    const hit = g.hits?.[0];
    if (!hit) return null;
    return hitToResult(hit);
  }).filter(Boolean) as TypesensePageResult[];
}

// --- Persons Search ---

interface TSPerson {
  id: string;
  pg_id: number;
  name: string;
  aliases?: string[];
  role: string;
  description: string;
  occupation?: string;
  category: string;
}

/**
 * Search persons via Typesense — typo-tolerant search on name, aliases, occupation, description.
 */
export async function typesenseSearchPersons(
  query: string,
  limit: number = 20,
): Promise<TypesensePersonResult[]> {
  const ts = getTypesenseClient();
  if (!ts) throw new Error("Typesense not configured");

  const result = await ts
    .collections<TSPerson>(PERSONS_COLLECTION)
    .documents()
    .search({
      q: query,
      query_by: "name,aliases,occupation,description",
      query_by_weights: "4,3,2,1",
      per_page: limit,
      page: 1,
      num_typos: 2,
      typo_tokens_threshold: 1,
    });

  return (result.hits ?? []).map((hit) => {
    const doc = hit.document;
    return {
      pgId: doc.pg_id,
      name: doc.name,
      aliases: doc.aliases ?? [],
      role: doc.role,
      description: doc.description,
      occupation: doc.occupation ?? null,
      category: doc.category,
    };
  });
}
