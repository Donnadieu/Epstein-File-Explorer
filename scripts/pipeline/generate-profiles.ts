import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { persons } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { normalizeName } from "../../server/storage";
import type { AIAnalysisDocument } from "../../shared/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const AI_ANALYZED_DIR = path.join(DATA_DIR, "ai-analyzed");

interface ProfileSection {
  id: string;
  title: string;
  content: string;
  order: number;
}

interface PersonAggregate {
  contexts: string[];
  roles: string[];
  keyFacts: string[];
  locations: Set<string>;
  events: { date: string; title: string; description: string; category: string }[];
  connectionDescriptions: string[];
  documentTypes: Map<string, number>;
}

function readAllAnalysisFiles(): AIAnalysisDocument[] {
  if (!fs.existsSync(AI_ANALYZED_DIR)) return [];
  const files = fs.readdirSync(AI_ANALYZED_DIR).filter(f => f.endsWith(".json"));
  const results: AIAnalysisDocument[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(AI_ANALYZED_DIR, file), "utf-8");
      const data = JSON.parse(raw) as AIAnalysisDocument;
      data.fileName = file;
      results.push(data);
    } catch {
      // skip invalid files
    }
  }
  return results;
}

function aggregatePersonData(
  personName: string,
  aliases: string[],
  allFiles: AIAnalysisDocument[]
): PersonAggregate {
  const normalizedTarget = normalizeName(personName);
  const normalizedAliases = (aliases ?? []).map(normalizeName);
  const allNormalized = [normalizedTarget, ...normalizedAliases];

  const agg: PersonAggregate = {
    contexts: [],
    roles: [],
    keyFacts: [],
    locations: new Set(),
    events: [],
    connectionDescriptions: [],
    documentTypes: new Map(),
  };

  for (const data of allFiles) {
    if (!Array.isArray(data.persons)) continue;

    const match = data.persons.find(p => {
      const norm = normalizeName(p.name ?? "");
      return allNormalized.some(target => target === norm);
    });

    if (!match) continue;

    if ((match as any).context) agg.contexts.push((match as any).context);
    if (match.role) agg.roles.push(match.role);

    if (data.documentType) {
      agg.documentTypes.set(data.documentType, (agg.documentTypes.get(data.documentType) ?? 0) + 1);
    }

    if (Array.isArray(data.keyFacts)) {
      for (const fact of data.keyFacts) {
        if (typeof fact === "string" && fact.toLowerCase().includes(personName.toLowerCase())) {
          agg.keyFacts.push(fact);
        }
      }
    }

    if (Array.isArray(data.locations)) {
      for (const loc of data.locations) {
        const location = typeof loc === "string" ? loc : ((loc as any).location ?? (loc as any).name ?? "");
        if (location) agg.locations.add(location);
      }
    }

    if (Array.isArray(data.events)) {
      for (const event of data.events) {
        const rawInvolved = (event as any).personsInvolved;
        const involved = Array.isArray(rawInvolved) ? rawInvolved : typeof rawInvolved === "string" ? rawInvolved.split(",").map((s: string) => s.trim()) : [];
        if (
          involved.some((p: string) => p.toLowerCase().includes(personName.split(" ").pop()!.toLowerCase())) ||
          (event.title ?? "").toLowerCase().includes(personName.toLowerCase()) ||
          (event.description ?? "").toLowerCase().includes(personName.toLowerCase())
        ) {
          agg.events.push({
            date: (event as any).date ?? "",
            title: event.title ?? "",
            description: event.description ?? "",
            category: (event as any).category ?? "",
          });
        }
      }
    }

    if (Array.isArray(data.connections)) {
      for (const conn of data.connections) {
        const p1Norm = normalizeName(conn.person1 ?? "");
        const p2Norm = normalizeName(conn.person2 ?? "");
        if (allNormalized.includes(p1Norm) || allNormalized.includes(p2Norm)) {
          if ((conn as any).description) agg.connectionDescriptions.push((conn as any).description);
        }
      }
    }
  }

  return agg;
}

function generateSections(
  personName: string,
  description: string,
  role: string,
  occupation: string | null,
  nationality: string | null,
  agg: PersonAggregate
): ProfileSection[] {
  const sections: ProfileSection[] = [];
  let order = 0;

  // Summary section — combine existing description with unique contexts
  const uniqueContexts = [...new Set(agg.contexts)];
  if (uniqueContexts.length > 0 || description) {
    const summaryParts = [description];
    const addedContexts = uniqueContexts
      .filter(c => c.length > 50 && !(description ?? "").toLowerCase().includes(c.toLowerCase().slice(0, 30)))
      .slice(0, 5);
    if (addedContexts.length > 0) {
      summaryParts.push(...addedContexts);
    }
    sections.push({
      id: "summary",
      title: "Summary",
      content: summaryParts.join("\n\n"),
      order: order++,
    });
  }

  // Background section
  const bgParts: string[] = [];
  if (occupation || nationality) {
    const parts = [];
    if (occupation) parts.push(occupation);
    if (nationality) parts.push(`(${nationality})`);
    bgParts.push(`${personName} is known as a ${parts.join(" ")}.`);
  }
  const uniqueRoles = [...new Set(agg.roles)].filter(r => r.length > 3);
  if (uniqueRoles.length > 0) {
    bgParts.push(`Roles identified in documents: ${uniqueRoles.join("; ")}.`);
  }
  if (bgParts.length > 0) {
    sections.push({
      id: "background",
      title: "Background",
      content: bgParts.join("\n\n"),
      order: order++,
    });
  }

  // Document types they appear in
  if (agg.documentTypes.size > 0) {
    const typeEntries = [...agg.documentTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type} (${count})`)
      .join(", ");
    sections.push({
      id: "document-references",
      title: "Document References",
      content: `${personName} appears in the following document types: ${typeEntries}.`,
      order: order++,
    });
  }

  // Connections
  const uniqueConns = [...new Set(agg.connectionDescriptions)].slice(0, 10);
  if (uniqueConns.length > 0) {
    sections.push({
      id: "connections",
      title: "Connections",
      content: uniqueConns.map(c => `- ${c}`).join("\n"),
      order: order++,
    });
  }

  // Legal / Criminal Activity
  const legalEvents = agg.events.filter(e =>
    ["legal", "criminal", "judicial", "indictment", "arrest", "sentencing", "plea"].includes(e.category.toLowerCase())
  );
  const legalFacts = agg.keyFacts.filter(f =>
    /immunity|plea|guilty|convicted|indicted|charged|prosecut|NPA|non-prosecution|co-conspirator|arrest|sentence/i.test(f)
  );
  if (legalEvents.length > 0 || legalFacts.length > 0) {
    const parts: string[] = [];
    const uniqueLegalFacts = [...new Set(legalFacts)].slice(0, 8);
    if (uniqueLegalFacts.length > 0) {
      parts.push(uniqueLegalFacts.map(f => `- ${f}`).join("\n"));
    }
    if (legalEvents.length > 0) {
      const eventLines = legalEvents
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 8)
        .map(e => `- ${e.date ? `[${e.date}] ` : ""}${e.title}: ${e.description}`);
      parts.push(eventLines.join("\n"));
    }
    sections.push({
      id: "criminal-activity",
      title: "Legal History",
      content: parts.join("\n\n"),
      order: order++,
    });
  }

  // Locations / Property visits
  if (agg.locations.size > 0) {
    const epsteinLocations = [...agg.locations].filter(l =>
      /palm beach|little st|zorro|teterboro|manhattan|66th|71st|new york|virgin islands|new mexico/i.test(l)
    );
    const otherLocations = [...agg.locations].filter(l =>
      !epsteinLocations.includes(l)
    );

    const parts: string[] = [];
    if (epsteinLocations.length > 0) {
      parts.push(`Epstein-associated locations mentioned: ${epsteinLocations.join(", ")}.`);
    }
    if (otherLocations.length > 0) {
      parts.push(`Other locations: ${otherLocations.slice(0, 10).join(", ")}.`);
    }
    sections.push({
      id: "locations",
      title: "Locations",
      content: parts.join("\n\n"),
      order: order++,
    });
  }

  return sections;
}

async function fetchWikipediaImage(name: string): Promise<{ imageUrl: string | null; wikiUrl: string | null }> {
  const title = name.replace(/\s+/g, "_");
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return { imageUrl: null, wikiUrl: null };
    const data = await response.json();
    return {
      imageUrl: data.thumbnail?.source ?? null,
      wikiUrl: data.content_urls?.desktop?.page ?? null,
    };
  } catch {
    return { imageUrl: null, wikiUrl: null };
  }
}

export async function generateProfiles() {
  console.log("Loading AI analysis files...");
  const allFiles = readAllAnalysisFiles();
  console.log(`Loaded ${allFiles.length} analysis files`);

  console.log("Fetching all persons from database...");
  const allPersons = await db.select().from(persons);
  console.log(`Found ${allPersons.length} persons`);

  for (const person of allPersons) {
    console.log(`\nProcessing: ${person.name}`);

    // Aggregate AI analysis data
    const agg = aggregatePersonData(person.name, person.aliases ?? [], allFiles);
    console.log(`  AI mentions: ${agg.contexts.length} contexts, ${agg.keyFacts.length} facts, ${agg.locations.size} locations, ${agg.events.length} events`);

    // Generate profile sections
    const profileSections = generateSections(
      person.name,
      person.description,
      person.role,
      person.occupation,
      person.nationality,
      agg
    );
    console.log(`  Generated ${profileSections.length} profile sections`);

    // Fetch Wikipedia image
    const wiki = await fetchWikipediaImage(person.name);
    if (wiki.imageUrl) console.log(`  Wikipedia image found`);
    if (wiki.wikiUrl) console.log(`  Wikipedia URL: ${wiki.wikiUrl}`);

    // Compute top contacts from connection descriptions
    // (This is a simplified version — in production you'd query the connections table)
    const topContacts = agg.connectionDescriptions.length > 0
      ? agg.connectionDescriptions.slice(0, 5).map(desc => ({
          name: desc.split(" ")[0] ?? "Unknown",
          connectionType: "mentioned",
        }))
      : null;

    // Update database
    await db.update(persons).set({
      profileSections: profileSections.length > 0 ? profileSections : null,
      imageUrl: wiki.imageUrl ?? person.imageUrl,
      wikipediaUrl: wiki.wikiUrl ?? person.wikipediaUrl,
      topContacts,
    }).where(eq(persons.id, person.id));

    console.log(`  Updated database`);

    // Rate limit Wikipedia API calls
    await new Promise(r => setTimeout(r, 100));
  }

  console.log("\nProfile generation complete!");
}

// Allow direct execution
if (process.argv[1]?.includes(path.basename(__filename))) {
  generateProfiles().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
