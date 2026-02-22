import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db, pool } from "../../server/db";
import { normalizeName } from "../../server/storage";
import { sql } from "drizzle-orm";
import type { AIPersonMention } from "./ai-analyzer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const AI_DIR = path.join(DATA_DIR, "ai-analyzed");
const OUTPUT_PATH = path.resolve(__dirname, "tier0-persons-generated.ts");
const TOP_N = 300;
const FETCH_LIMIT = 1500; // fetch more than TOP_N, filter in JS

// --- Non-person filters ---

const ORG_KEYWORDS = /\b(inc|llc|corp|corporation|department|dept|office|bureau|agency|court|company|co|foundation|university|institute|group|committee|firm|association|bank|service|services|hotel|airlines|airline|club|resort|trust|estate|estates|ltd|lp|partners|partnership|federal|state|county|city|national|international|organization|board|commission|council|division|unit|center|school|academy|holdings|enterprises|management|consulting|media|publishing|press|records|fund|securities|investments|capital|financial|aviation|airlines|telecom|telecommunications|communications|network|systems|technologies|tech|software|solutions|global|worldwide|americas|properties|realty|development|construction|design|studio|gallery|museum|library|hospital|clinic|medical|pharmacy|laboratory|lab|research)\b/;
const PLACEHOLDER_PATTERN = /\b(jane|john)\s+doe\b|^doe\s+\d|^doe$/;
const REDACTED_PATTERN = /redacted|sealed|unknown|confidential|unnamed|unidentified|anonymous|\[.*\]|\(.*redact.*\)/;
const GENERIC_NAME_PATTERN = /^(agent|detective|officer|judge|attorney|counsel|witness|victim|defendant|plaintiff|interviewer|investigator|respondent|complainant|petitioner|claimant|applicant|deponent|affiant|declarant|correspondent|sender|recipient|caller|client|patient|student|employee|employer|manager|director|supervisor|secretary|assistant|clerk|staff|member|person|individual|male|female|minor|child|adult|mr|mrs|ms|dr)$/;

function isNonPerson(name: string): boolean {
  if (!name || name.length < 4) return true;
  if (!name.includes(" ")) return true; // single-word

  if (ORG_KEYWORDS.test(name)) return true;
  if (PLACEHOLDER_PATTERN.test(name)) return true;
  if (REDACTED_PATTERN.test(name)) return true;
  if (GENERIC_NAME_PATTERN.test(name)) return true;

  // Pure initials: every word is 1 char (e.g., "j e")
  const words = name.split(" ");
  if (words.every((w) => w.length <= 1)) return true;

  // Numeric-heavy names (like "victim 1", "witness 2")
  if (/\d/.test(name) && words.some((w) => /^\d+$/.test(w))) return true;

  return false;
}

// --- Proper casing ---

function properCase(name: string): string {
  return name
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// --- DB approach ---

interface PersonAggregate {
  normalizedName: string;
  totalMentions: number;
  docCount: number;
  topRole: string;
  topCategory: string;
}

async function generateFromDB(): Promise<PersonAggregate[]> {
  // Single query: aggregate mentions + get most common role/category via lateral join
  const result = await db.execute(sql`
    WITH person_totals AS (
      SELECT
        normalized_name,
        SUM(mention_count)::int AS total_mentions,
        COUNT(DISTINCT ai_analysis_id)::int AS doc_count
      FROM ai_analysis_persons
      WHERE normalized_name IS NOT NULL AND normalized_name != ''
      GROUP BY normalized_name
      ORDER BY total_mentions DESC
      LIMIT ${FETCH_LIMIT}
    ),
    top_roles AS (
      SELECT DISTINCT ON (normalized_name)
        normalized_name,
        role,
        SUM(mention_count) AS role_mentions
      FROM ai_analysis_persons
      WHERE normalized_name IN (SELECT normalized_name FROM person_totals)
        AND role IS NOT NULL AND role != ''
      GROUP BY normalized_name, role
      ORDER BY normalized_name, role_mentions DESC
    ),
    top_categories AS (
      SELECT DISTINCT ON (normalized_name)
        normalized_name,
        category,
        SUM(mention_count) AS cat_mentions
      FROM ai_analysis_persons
      WHERE normalized_name IN (SELECT normalized_name FROM person_totals)
        AND category IS NOT NULL AND category != ''
      GROUP BY normalized_name, category
      ORDER BY normalized_name, cat_mentions DESC
    )
    SELECT
      pt.normalized_name,
      pt.total_mentions,
      pt.doc_count,
      COALESCE(tr.role, 'Unknown') AS top_role,
      COALESCE(tc.category, 'other') AS top_category
    FROM person_totals pt
    LEFT JOIN top_roles tr ON tr.normalized_name = pt.normalized_name
    LEFT JOIN top_categories tc ON tc.normalized_name = pt.normalized_name
    ORDER BY pt.total_mentions DESC
  `);

  return (result.rows as any[]).map((row) => ({
    normalizedName: row.normalized_name,
    totalMentions: Number(row.total_mentions),
    docCount: Number(row.doc_count),
    topRole: row.top_role,
    topCategory: row.top_category,
  }));
}

// --- JSON fallback approach ---

async function generateFromJSON(): Promise<PersonAggregate[]> {
  console.log("  Reading JSON files from", AI_DIR);

  const files = fs.readdirSync(AI_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("  No JSON files found");
    return [];
  }

  console.log(`  Processing ${files.length} files...`);

  // Accumulate: normalizedName → { totalMentions, roleCounts, categoryCounts }
  const acc = new Map<
    string,
    {
      totalMentions: number;
      docIds: Set<string>;
      roleCounts: Map<string, number>;
      categoryCounts: Map<string, number>;
    }
  >();

  let processed = 0;
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(AI_DIR, file), "utf-8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data.persons)) continue;

      for (const p of data.persons as AIPersonMention[]) {
        if (!p.name) continue;
        const normalized = normalizeName(p.name);
        if (!normalized) continue;

        let entry = acc.get(normalized);
        if (!entry) {
          entry = {
            totalMentions: 0,
            docIds: new Set(),
            roleCounts: new Map(),
            categoryCounts: new Map(),
          };
          acc.set(normalized, entry);
        }

        const mc = p.mentionCount || 1;
        entry.totalMentions += mc;
        entry.docIds.add(file);
        entry.roleCounts.set(
          p.role || "Unknown",
          (entry.roleCounts.get(p.role || "Unknown") || 0) + mc,
        );
        entry.categoryCounts.set(
          p.category || "other",
          (entry.categoryCounts.get(p.category || "other") || 0) + mc,
        );
      }
    } catch {
      // skip malformed files
    }

    processed++;
    if (processed % 5000 === 0) {
      console.log(`  Processed ${processed}/${files.length}`);
    }
  }

  console.log(`  Found ${acc.size} unique normalized names`);

  // Convert to sorted array
  const results: PersonAggregate[] = [];
  for (const [normalized, entry] of acc) {
    let topRole = "Unknown";
    let topRoleCount = 0;
    for (const [role, count] of entry.roleCounts) {
      if (count > topRoleCount) {
        topRole = role;
        topRoleCount = count;
      }
    }

    let topCategory = "other";
    let topCatCount = 0;
    for (const [cat, count] of entry.categoryCounts) {
      if (count > topCatCount) {
        topCategory = cat;
        topCatCount = count;
      }
    }

    results.push({
      normalizedName: normalized,
      totalMentions: entry.totalMentions,
      docCount: entry.docIds.size,
      topRole,
      topCategory,
    });
  }

  results.sort((a, b) => b.totalMentions - a.totalMentions);
  return results.slice(0, FETCH_LIMIT);
}

// --- Output generation ---

function writeOutputFile(
  persons: Array<{
    name: string;
    role: string;
    category: string;
    totalMentions: number;
    docCount: number;
  }>,
): void {
  const lines = persons.map(
    (p) =>
      `  ["${p.name}", "${p.role.replace(/"/g, '\\"')}", "${p.category}"],`,
  );

  const content = `// Auto-generated by generate-tier0-persons.ts — do not edit manually
// Generated: ${new Date().toISOString()}
// Source: ${persons.length} persons from AI analysis of 24,000+ documents
// Top person: ${persons[0]?.name ?? "N/A"} (${persons[0]?.totalMentions ?? 0} mentions across ${persons[0]?.docCount ?? 0} documents)
import type { AIPersonMention } from "./ai-analyzer";

export const GENERATED_TIER0_PERSONS: [string, string, AIPersonMention["category"]][] = [
${lines.join("\n")}
];
`;

  fs.writeFileSync(OUTPUT_PATH, content, "utf-8");
}

// --- Main ---

export async function generateTier0Persons(): Promise<void> {
  console.log("\n[generate-tier0] Mining AI analysis data for known persons...");

  let aggregates: PersonAggregate[] = [];

  // Try DB first
  try {
    console.log("  Querying ai_analysis_persons table...");
    aggregates = await generateFromDB();
    console.log(`  DB returned ${aggregates.length} person aggregates`);
  } catch (err: any) {
    console.log(`  DB query failed (${err.message}), falling back to JSON files`);
    aggregates = [];
  }

  // Fallback to JSON
  if (aggregates.length === 0) {
    aggregates = await generateFromJSON();
  }

  if (aggregates.length === 0) {
    console.log("  No person data found. Skipping generation.");
    return;
  }

  // Filter non-persons and take top N
  const filtered = aggregates.filter((p) => !isNonPerson(p.normalizedName));
  const top = filtered.slice(0, TOP_N);

  console.log(
    `  After filtering: ${filtered.length} persons (from ${aggregates.length} raw). Taking top ${TOP_N}.`,
  );

  const output = top.map((p) => ({
    name: p.normalizedName,
    role: p.topRole,
    category: p.topCategory,
    totalMentions: p.totalMentions,
    docCount: p.docCount,
  }));

  writeOutputFile(output);

  console.log(`  Written ${output.length} persons to ${OUTPUT_PATH}`);
  console.log(
    `  Top 10: ${output
      .slice(0, 10)
      .map((p) => `${properCase(p.name)} (${p.totalMentions})`)
      .join(", ")}`,
  );
  console.log("[generate-tier0] Done.\n");
}

// Standalone execution
if (process.argv[1]?.includes(path.basename(__filename))) {
  generateTier0Persons()
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}
