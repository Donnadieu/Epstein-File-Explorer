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

// --- Name deduplication ---
// Adapted from server/storage.ts isSamePerson() for PersonAggregate objects.
// Merges name variants (middle initials, nicknames, OCR typos) using Union-Find.

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const DEDUP_NICKNAMES: Record<string, string> = {
  bob: "robert",
  rob: "robert",
  bobby: "robert",
  robby: "robert",
  bill: "william",
  billy: "william",
  will: "william",
  willy: "william",
  jim: "james",
  jimmy: "james",
  jes: "james",
  jamie: "james",
  mike: "michael",
  mikey: "michael",
  dick: "richard",
  rick: "richard",
  rich: "richard",
  ricky: "richard",
  tom: "thomas",
  tommy: "thomas",
  joe: "joseph",
  joey: "joseph",
  jack: "john",
  johnny: "john",
  jon: "john",
  ted: "theodore",
  teddy: "theodore",
  ed: "edward",
  eddie: "edward",
  al: "albert",
  bert: "albert",
  alex: "alexander",
  sandy: "alexander",
  dan: "daniel",
  danny: "daniel",
  dave: "david",
  davy: "david",
  steve: "steven",
  stevie: "steven",
  chris: "christopher",
  nick: "nicholas",
  nicky: "nicholas",
  tony: "anthony",
  larry: "lawrence",
  laurence: "lawrence",
  charlie: "charles",
  chuck: "charles",
  harry: "henry",
  hank: "henry",
  greg: "gregory",
  matt: "matthew",
  pat: "patrick",
  pete: "peter",
  sam: "samuel",
  ben: "benjamin",
  ken: "kenneth",
  kenny: "kenneth",
  meg: "megan",
  meghan: "megan",
  // Additions not in server/storage.ts NICKNAMES:
  jeff: "jeffrey",
  les: "leslie",
  don: "donald",
  donny: "donald",
};

function canonicalFirst(name: string): string {
  return DEDUP_NICKNAMES[name] ?? name;
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "esq"]);

function stripSuffixes(parts: string[]): string[] {
  while (parts.length > 2 && NAME_SUFFIXES.has(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }
  return parts;
}

function shouldMerge(nameA: string, nameB: string): boolean {
  if (nameA === nameB) return true;

  const partsA = stripSuffixes(nameA.split(" ").filter(Boolean));
  const partsB = stripSuffixes(nameB.split(" ").filter(Boolean));
  if (partsA.length < 2 || partsB.length < 2) return false;

  // Guard: very long names are likely concatenation artifacts
  if (partsA.length > 5 || partsB.length > 5) return false;

  // Rebuild names after suffix stripping for containment/levenshtein checks
  const strippedA = partsA.join(" ");
  const strippedB = partsB.join(" ");

  const lastA = partsA[partsA.length - 1];
  const lastB = partsB[partsB.length - 1];
  const firstA = partsA[0];
  const firstB = partsB[0];
  const realFirstA = partsA.find((p) => p.length >= 2) ?? firstA;
  const realFirstB = partsB.find((p) => p.length >= 2) ?? firstB;

  // --- Strip middle names/initials (keep first + last word) ---
  const coreA = partsA.length > 2 ? `${firstA} ${lastA}` : strippedA;
  const coreB = partsB.length > 2 ? `${firstB} ${lastB}` : strippedB;
  if (coreA === coreB && coreA.length >= 6) return true;

  // Strip middle using realFirst (handles "r alexander acosta" → "alexander acosta")
  const rcoreA = partsA.length > 2 ? `${realFirstA} ${lastA}` : strippedA;
  const rcoreB = partsB.length > 2 ? `${realFirstB} ${lastB}` : strippedB;
  if (rcoreA === rcoreB && rcoreA.length >= 6) return true;

  // --- Spaceless key (catches "brennanwiebracht" vs "brennan wiebracht") ---
  const spacelessA = nameA.replace(/\s+/g, "");
  const spacelessB = nameB.replace(/\s+/g, "");
  if (spacelessA.length >= 6 && spacelessA === spacelessB) return true;

  // --- First-name matching helper ---
  function firstNamesMatch(fA: string, fB: string): boolean {
    if (fA === fB) return true;
    // Initial: "j" matches "jeffrey"
    if (fA.length === 1 && fB.startsWith(fA)) return true;
    if (fB.length === 1 && fA.startsWith(fB)) return true;
    // Prefix: "jeff" starts with "jeffrey" truncation
    if (fA.length >= 3 && fB.length >= 3 && (fA.startsWith(fB) || fB.startsWith(fA)))
      return true;
    // Nickname: "jeff"→"jeffrey", "larry"→"lawrence"
    if (canonicalFirst(fA) === canonicalFirst(fB)) return true;
    // Canonical prefix: "alex"→"alexander" matches "alexander"
    const cA = canonicalFirst(fA),
      cB = canonicalFirst(fB);
    if (cA.length >= 4 && cB.length >= 4 && (cA.startsWith(cB) || cB.startsWith(cA)))
      return true;
    // Fuzzy: "jeanie" ↔ "jeanne" (OCR/typo, ≤ 2 edits)
    if (fA.length >= 4 && fB.length >= 4 && levenshtein(fA, fB) <= 2) return true;
    return false;
  }

  // --- Same last name: check first names ---
  if (lastA === lastB && lastA.length >= 3) {
    if (firstNamesMatch(firstA, firstB)) return true;
    // Try realFirst for names with leading initials
    if (realFirstA !== firstA || realFirstB !== firstB) {
      if (firstNamesMatch(realFirstA, realFirstB)) return true;
    }
  }

  // --- Same last name + realFirst match (skip leading initials) ---
  if (lastA === lastB && lastA.length >= 3 && (realFirstA !== firstA || realFirstB !== firstB)) {
    if (realFirstA.length >= 3 && realFirstB.length >= 3) {
      if (realFirstA === realFirstB) return true;
      if (realFirstA.startsWith(realFirstB) || realFirstB.startsWith(realFirstA)) return true;
      if (canonicalFirst(realFirstA) === canonicalFirst(realFirstB)) return true;
      const rcA = canonicalFirst(realFirstA),
        rcB = canonicalFirst(realFirstB);
      if (rcA.startsWith(rcB) || rcB.startsWith(rcA)) return true;
    }
  }

  // --- Fuzzy last name (OCR): lev ≤ 2 with matching first name ---
  if (lastA.length >= 5 && lastB.length >= 5 && levenshtein(lastA, lastB) <= 2) {
    if (firstNamesMatch(firstA, firstB)) return true;
    // Also try realFirst for names with leading initials
    if (realFirstA !== firstA || realFirstB !== firstB) {
      if (firstNamesMatch(realFirstA, realFirstB)) return true;
    }
  }

  // Same canonical first + fuzzy last (lev ≤ 2, last ≥ 6 chars)
  if (lastA.length >= 6 && lastB.length >= 6 && levenshtein(lastA, lastB) <= 2) {
    const cA = canonicalFirst(firstA),
      cB = canonicalFirst(firstB);
    if (cA === cB && cA.length >= 3) return true;
  }

  // --- Last name prefix: "Mennin" vs "Menninger" ---
  if (firstA === firstB && firstA.length >= 3) {
    const shortLast = lastA.length <= lastB.length ? lastA : lastB;
    const longLast = lastA.length <= lastB.length ? lastB : lastA;
    if (shortLast.length >= 4 && longLast.startsWith(shortLast)) return true;
  }

  // --- Full-name Levenshtein ≤ 2 with shared first OR last word ---
  if (strippedA.length >= 10 && strippedB.length >= 10 && levenshtein(strippedA, strippedB) <= 2) {
    if (firstA === firstB && lastA.length >= 4 && lastB.length >= 4 && levenshtein(lastA, lastB) <= 2)
      return true;
    if (lastA === lastB && firstA.length >= 3 && firstB.length >= 3 && levenshtein(firstA, firstB) <= 2)
      return true;
  }

  // Short full-name fuzzy (≤ 2, shared first or last word)
  if (strippedA.length >= 8 && strippedB.length >= 8) {
    const lenDiff = Math.abs(strippedA.length - strippedB.length);
    if (lenDiff <= 2 && levenshtein(strippedA, strippedB) <= 2) {
      if (firstA === firstB || lastA === lastB) return true;
    }
  }

  // --- Containment: shorter name is inside longer name ---
  if (strippedA.length >= 8 && strippedB.length >= 8 && strippedA.length !== strippedB.length) {
    const shorter = strippedA.length < strippedB.length ? strippedA : strippedB;
    const longer = strippedA.length < strippedB.length ? strippedB : strippedA;
    const sParts = shorter.split(" ").filter(Boolean);
    const lParts = longer.split(" ").filter(Boolean);
    if (sParts.length >= 2 && longer.includes(shorter)) {
      if (longer.startsWith(shorter)) return true;
      if (sParts[0] === lParts[0]) return true;
    }
  }

  return false;
}

/** Category specificity: lower = more specific (preferred when merging) */
const CATEGORY_RANK: Record<string, number> = {
  "key figure": 0,
  associate: 1,
  victim: 2,
  witness: 3,
  legal: 4,
  political: 5,
  "law enforcement": 6,
  staff: 7,
  other: 8,
};

function deduplicatePersons(persons: PersonAggregate[]): PersonAggregate[] {
  const n = persons.length;
  const parent: number[] = Array.from({ length: n }, (_, i) => i);
  const rank: number[] = new Array(n).fill(0);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(x: number, y: number): void {
    const rx = find(x),
      ry = find(y);
    if (rx === ry) return;
    if (rank[rx] < rank[ry]) parent[rx] = ry;
    else if (rank[rx] > rank[ry]) parent[ry] = rx;
    else {
      parent[ry] = rx;
      rank[rx]++;
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (find(i) !== find(j)) {
        if (shouldMerge(persons[i].normalizedName, persons[j].normalizedName)) {
          union(i, j);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const merged: PersonAggregate[] = [];
  let totalEliminated = 0;

  for (const indices of groups.values()) {
    if (indices.length === 1) {
      merged.push(persons[indices[0]]);
      continue;
    }

    const group = indices.map((i) => persons[i]);
    group.sort((a, b) => b.totalMentions - a.totalMentions);
    const canonical = group[0];

    const combinedMentions = group.reduce((s, p) => s + p.totalMentions, 0);
    const combinedDocs = group.reduce((s, p) => s + p.docCount, 0);

    // Prefer non-generic role from highest-mention variant
    const topRole =
      group.find((p) => p.topRole && p.topRole !== "Unknown")?.topRole ??
      canonical.topRole;

    // Prefer most specific category
    const topCategory = group.reduce((best, p) => {
      const bestRank = CATEGORY_RANK[best] ?? 8;
      const pRank = CATEGORY_RANK[p.topCategory] ?? 8;
      return pRank < bestRank ? p.topCategory : best;
    }, canonical.topCategory);

    const names = group
      .map((p) => `"${p.normalizedName}" (${p.totalMentions})`)
      .join(", ");
    console.log(
      `    Merged ${group.length} → "${canonical.normalizedName}": ${names}`,
    );
    totalEliminated += group.length - 1;

    merged.push({
      normalizedName: canonical.normalizedName,
      totalMentions: combinedMentions,
      docCount: combinedDocs,
      topRole,
      topCategory,
    });
  }

  merged.sort((a, b) => b.totalMentions - a.totalMentions);
  console.log(
    `  [dedup] ${n} → ${merged.length} unique persons (${totalEliminated} duplicates eliminated)`,
  );
  return merged;
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

  // Filter non-persons, deduplicate, and take top N
  const filtered = aggregates.filter((p) => !isNonPerson(p.normalizedName));
  console.log(
    `  After filtering: ${filtered.length} persons (from ${aggregates.length} raw). Deduplicating...`,
  );
  const deduped = deduplicatePersons(filtered);
  const top = deduped.slice(0, TOP_N);

  console.log(`  Taking top ${TOP_N} from ${deduped.length} deduplicated persons.`);

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
