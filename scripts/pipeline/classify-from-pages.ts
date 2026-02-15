import OpenAI from "openai";
import { db } from "../../server/db";
import { documents, documentPages, budgetTracking } from "../../shared/schema";
import { eq, and, sql, inArray, asc } from "drizzle-orm";

// --- DeepSeek client ---

const DEEPSEEK_MODEL = "deepseek-chat";
const DEEPSEEK_INPUT_COST_PER_M = 0.27;
const DEEPSEEK_OUTPUT_COST_PER_M = 1.10;
const MAX_CHARS_PER_REQUEST = 24000;
const DELAY_BETWEEN_DOCS_MS = 1500;

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

// --- Canonical type normalization (from backfill-document-types.ts) ---

const CANONICAL_TYPE_MAP: [string, RegExp][] = [
  ["correspondence", /correspondence|email|letter|memo|fax|internal memorandum/i],
  ["court filing", /court filing|court order|indictment|plea|subpoena|motion|docket/i],
  ["fbi report", /fbi|302|bureau/i],
  ["deposition", /deposition|interview transcript/i],
  ["grand jury transcript", /grand jury/i],
  ["flight log", /flight|manifest|aircraft/i],
  ["financial record", /financial|bank|account|employment record/i],
  ["search warrant", /search warrant|seizure|elsur/i],
  ["police report", /police|incident report|booking/i],
  ["property record", /property|real estate/i],
  ["news article", /news|press|article|magazine/i],
  ["travel record", /travel|passport|immigration/i],
];

const VALID_TYPES = new Set([
  "correspondence", "court filing", "fbi report", "deposition",
  "grand jury transcript", "flight log", "financial record",
  "search warrant", "police report", "property record",
  "news article", "travel record", "email", "contact list",
  "photograph", "video", "government record",
]);

function normalizeType(aiType: string): string {
  const lower = aiType.toLowerCase().trim();
  if (VALID_TYPES.has(lower)) return lower;
  for (const [canonical, pattern] of CANONICAL_TYPE_MAP) {
    if (pattern.test(lower)) return canonical;
  }
  return "government record";
}

// --- DeepSeek classification prompt ---

const SYSTEM_PROMPT = `You classify Epstein case documents from publicly released DOJ records. Given document text split by page markers, return the overall document type and a type for each page.

Valid document types:
court filing, correspondence, fbi report, deposition, grand jury transcript, flight log, financial record, search warrant, police report, property record, news article, travel record, email, contact list, photograph, video, government record

Rules:
- Choose the most specific type that fits the content
- If a page is a cover sheet or filler, classify it as the dominant document type
- If page text is too short or garbled to classify, use the overall document type
- Respond ONLY with valid JSON, no markdown fences

JSON format:
{
  "documentType": "string",
  "pageTypes": [{"page": 1, "type": "string"}, ...]
}`;

// --- Classification logic ---

interface ClassificationResult {
  documentType: string;
  pageTypes: { page: number; type: string }[];
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

function buildPageText(pages: { pageNumber: number; content: string }[]): string {
  let text = "";
  for (const p of pages) {
    const header = `\n--- Page ${p.pageNumber} ---\n`;
    text += header + p.content.slice(0, 3000) + "\n";
  }
  // Truncate to fit DeepSeek context
  return text.slice(0, MAX_CHARS_PER_REQUEST);
}

async function classifyDocument(
  docTitle: string,
  pages: { pageNumber: number; content: string }[],
): Promise<ClassificationResult> {
  const pageText = buildPageText(pages);

  const response = await getDeepSeek().chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Classify this document: "${docTitle}"\n\n${pageText}` },
    ],
    max_tokens: 2048,
    temperature: 0.1,
  });

  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const costCents =
    (inputTokens / 1_000_000) * DEEPSEEK_INPUT_COST_PER_M +
    (outputTokens / 1_000_000) * DEEPSEEK_OUTPUT_COST_PER_M;

  let content = response.choices[0]?.message?.content ?? "";
  content = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error(`Could not parse classification response: ${content.slice(0, 200)}`);
    }
  }

  const documentType = normalizeType(parsed.documentType || "government record");
  const pageTypes = (parsed.pageTypes || []).map((pt: any) => ({
    page: pt.page,
    type: normalizeType(pt.type || documentType),
  }));

  return { documentType, pageTypes, inputTokens, outputTokens, costCents };
}

// --- Budget tracking ---

async function getMonthlySpend(): Promise<number> {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const result = await db
    .select({ totalCents: sql<number>`COALESCE(SUM(${budgetTracking.costCents}), 0)::int` })
    .from(budgetTracking)
    .where(sql`${budgetTracking.date} >= ${monthStart}`);
  return result[0]?.totalCents ?? 0;
}

async function recordCost(documentId: number, costCents: number, inputTokens: number, outputTokens: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(budgetTracking).values({
    date: today,
    model: "deepseek/deepseek-chat-v3-0324",
    inputTokens,
    outputTokens,
    costCents: Math.round(costCents * 100) / 100,
    documentId,
    jobType: "page_classification",
  });
}

// --- Main ---

interface Config {
  limit: number;
  monthlyCapCents: number;
  dryRun: boolean;
  batchSize: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Classify Documents from Page Content (DeepSeek AI)

Reads document_pages content from the database, sends to DeepSeek for
classification, and updates documents.documentType + document_pages.pageType.

USAGE:
  npx tsx scripts/pipeline/classify-from-pages.ts [options]

OPTIONS:
  --limit N          Max documents to classify (default: 100)
  --monthly-cap N    Budget cap in cents (default: 500 = $5.00)
  --dry-run          Preview without making API calls or DB updates
  --batch-size N     Documents per DB fetch batch (default: 20)
`);
    process.exit(0);
  }

  const config: Config = {
    limit: 100,
    monthlyCapCents: 500,
    dryRun: false,
    batchSize: 20,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) config.limit = parseInt(args[++i], 10);
    else if (args[i] === "--monthly-cap" && args[i + 1]) config.monthlyCapCents = parseInt(args[++i], 10);
    else if (args[i] === "--dry-run") config.dryRun = true;
    else if (args[i] === "--batch-size" && args[i + 1]) config.batchSize = parseInt(args[++i], 10);
  }

  console.log("\n=== Document Page Classifier (DeepSeek) ===\n");
  console.log(`Limit: ${config.limit}`);
  console.log(`Monthly cap: $${(config.monthlyCapCents / 100).toFixed(2)}`);
  console.log(`Batch size: ${config.batchSize}`);
  if (config.dryRun) console.log("MODE: DRY RUN\n");

  // Check budget
  const monthlySpent = await getMonthlySpend();
  let budgetRemaining = config.monthlyCapCents - monthlySpent;
  console.log(`Monthly spend: $${(monthlySpent / 100).toFixed(2)} / $${(config.monthlyCapCents / 100).toFixed(2)} (remaining: $${(budgetRemaining / 100).toFixed(2)})`);

  if (budgetRemaining <= 0 && !config.dryRun) {
    console.log("\nMonthly budget exhausted. Exiting.");
    process.exit(0);
  }

  // Find unclassified documents that have pages
  const unclassifiedDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      documentType: documents.documentType,
      dataSet: documents.dataSet,
    })
    .from(documents)
    .where(
      and(
        inArray(documents.documentType, ["government record", "photograph"]),
        sql`EXISTS (SELECT 1 FROM document_pages WHERE document_id = ${documents.id})`,
      ),
    )
    .limit(config.limit);

  console.log(`\nFound ${unclassifiedDocs.length} unclassified documents with pages\n`);

  if (unclassifiedDocs.length === 0) {
    console.log("Nothing to classify.");
    process.exit(0);
  }

  let classified = 0;
  let failed = 0;
  let totalCost = 0;
  const typeDistribution = new Map<string, number>();

  for (const doc of unclassifiedDocs) {
    if (budgetRemaining <= 0 && !config.dryRun) {
      console.log("Budget exhausted, stopping.");
      break;
    }

    // Fetch pages for this document
    const pages = await db
      .select({ pageNumber: documentPages.pageNumber, content: documentPages.content })
      .from(documentPages)
      .where(eq(documentPages.documentId, doc.id))
      .orderBy(asc(documentPages.pageNumber));

    if (pages.length === 0) continue;

    const totalChars = pages.reduce((sum, p) => sum + p.content.length, 0);

    if (config.dryRun) {
      console.log(`  [DRY] ${doc.title} (DS${doc.dataSet}, ${pages.length} pages, ${totalChars} chars)`);
      classified++;
      continue;
    }

    try {
      const result = await classifyDocument(doc.title, pages);

      // Update document type
      await db
        .update(documents)
        .set({ documentType: result.documentType })
        .where(eq(documents.id, doc.id));

      // Update page types
      for (const pt of result.pageTypes) {
        await db
          .update(documentPages)
          .set({ pageType: pt.type })
          .where(
            and(
              eq(documentPages.documentId, doc.id),
              eq(documentPages.pageNumber, pt.page),
            ),
          );
      }

      // For pages not returned by AI, set to document type
      const classifiedPageNums = new Set(result.pageTypes.map(pt => pt.page));
      for (const page of pages) {
        if (!classifiedPageNums.has(page.pageNumber)) {
          await db
            .update(documentPages)
            .set({ pageType: result.documentType })
            .where(
              and(
                eq(documentPages.documentId, doc.id),
                eq(documentPages.pageNumber, page.pageNumber),
              ),
            );
        }
      }

      // Track cost
      if (result.costCents > 0) {
        await recordCost(doc.id, result.costCents, result.inputTokens, result.outputTokens);
        budgetRemaining -= result.costCents;
        totalCost += result.costCents;
      }

      // Update per-document AI cost
      await db
        .update(documents)
        .set({ aiCostCents: sql`COALESCE(${documents.aiCostCents}, 0) + ${Math.ceil(result.costCents)}` })
        .where(eq(documents.id, doc.id));

      classified++;
      typeDistribution.set(result.documentType, (typeDistribution.get(result.documentType) || 0) + 1);

      console.log(
        `  [${classified}/${unclassifiedDocs.length}] ${doc.title} → ${result.documentType} (${pages.length} pages, ${result.costCents.toFixed(3)}c)`
      );

      // Rate limiting
      await sleep(DELAY_BETWEEN_DOCS_MS);
    } catch (error: any) {
      failed++;
      console.error(`  Error classifying ${doc.title}: ${error.message}`);

      if (error.message?.includes("429") || error.message?.includes("rate")) {
        console.log("  Rate limited, waiting 10s...");
        await sleep(10000);
      }
    }
  }

  // Summary
  console.log("\n=== Classification Summary ===");
  console.log(`Classified: ${classified}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total cost: $${(totalCost / 100).toFixed(4)}`);

  if (typeDistribution.size > 0) {
    console.log("\nType distribution:");
    for (const [type, count] of [...typeDistribution.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
