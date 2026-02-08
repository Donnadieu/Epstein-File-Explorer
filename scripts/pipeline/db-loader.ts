import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { persons, documents, connections, personDocuments, timelineEvents } from "../../shared/schema";
import { sql, eq, inArray } from "drizzle-orm";
import { isSamePerson } from "../../server/storage";
import type { RawPerson } from "./wikipedia-scraper";
import type { DOJCatalog, DOJDataSet } from "./doj-scraper";
import type { AIAnalysisResult, AIPersonMention, AIConnection, AIEvent } from "./ai-analyzer";
import { classifyAllDocuments } from "./media-classifier";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

let _deepseek: OpenAI | null = null;
function getDeepSeek(): OpenAI | null {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  if (!_deepseek) {
    _deepseek = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
  }
  return _deepseek;
}

export async function loadPersonsFromFile(filePath?: string): Promise<number> {
  const file = filePath || path.join(DATA_DIR, "persons-raw.json");
  if (!fs.existsSync(file)) {
    console.error(`Persons file not found: ${file}`);
    return 0;
  }

  const rawPersons: RawPerson[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  console.log(`Loading ${rawPersons.length} persons into database...`);

  let loaded = 0;
  let skipped = 0;

  for (const person of rawPersons) {
    try {
      const existing = await db
        .select()
        .from(persons)
        .where(sql`LOWER(${persons.name}) = LOWER(${person.name})`)
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(persons)
          .set({
            description: person.description || existing[0].description,
            category: person.category || existing[0].category,
            occupation: person.occupation || existing[0].occupation,
            nationality: person.nationality || existing[0].nationality,
            status: person.status || existing[0].status,
            role: person.role || existing[0].role,
          })
          .where(eq(persons.id, existing[0].id));
        skipped++;
      } else {
        await db.insert(persons).values({
          name: person.name,
          aliases: person.aliases.length > 0 ? person.aliases : null,
          role: person.role || "Named individual",
          description: person.description || `Named in Epstein files. ${person.occupation || ""}`.trim(),
          status: person.status || "named",
          nationality: person.nationality || "Unknown",
          occupation: person.occupation || "Unknown",
          documentCount: 0,
          connectionCount: 0,
          category: person.category || "associate",
        });
        loaded++;
      }
    } catch (error: any) {
      console.warn(`  Error loading ${person.name}: ${error.message}`);
    }
  }

  console.log(`  Loaded: ${loaded} new, ${skipped} updated`);
  return loaded;
}

export async function loadDocumentsFromCatalog(catalogPath?: string): Promise<number> {
  const file = catalogPath || path.join(DATA_DIR, "doj-catalog.json");
  if (!fs.existsSync(file)) {
    console.error(`Catalog file not found: ${file}`);
    return 0;
  }

  const catalog: DOJCatalog = JSON.parse(fs.readFileSync(file, "utf-8"));
  console.log(`Loading documents from ${catalog.dataSets.length} data sets...`);

  let loaded = 0;

  for (const dataSet of catalog.dataSets) {
    // Skip data set overview entries — they're directory pages, not actual documents
    for (const file of dataSet.files) {
      const fileExisting = await db
        .select()
        .from(documents)
        .where(sql`${documents.sourceUrl} = ${file.url}`)
        .limit(1);

      if (fileExisting.length > 0) continue;

      try {
        await db.insert(documents).values({
          title: file.title || path.basename(file.url),
          description: `File from ${dataSet.name}: ${file.title || file.url}`,
          documentType: mapFileTypeToDocType(file.fileType),
          dataSet: String(dataSet.id),
          sourceUrl: file.url,
          datePublished: "2026-01-30",
          isRedacted: true,
          tags: [file.fileType, `data-set-${dataSet.id}`],
        });
        loaded++;
      } catch {
        /* skip duplicates */
      }
    }
  }

  console.log(`  Loaded ${loaded} documents from catalog`);
  return loaded;
}

export async function loadAIResults(): Promise<{ persons: number; connections: number; events: number; docLinks: number }> {
  const aiDir = path.join(DATA_DIR, "ai-analyzed");
  if (!fs.existsSync(aiDir)) {
    console.error(`AI results directory not found: ${aiDir}`);
    return { persons: 0, connections: 0, events: 0, docLinks: 0 };
  }

  const files = fs.readdirSync(aiDir).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No AI analysis results found.");
    return { persons: 0, connections: 0, events: 0, docLinks: 0 };
  }

  console.log(`Loading AI results from ${files.length} files...`);

  let personsLoaded = 0;
  let connectionsLoaded = 0;
  let eventsLoaded = 0;
  let docLinksCreated = 0;

  const existingPairs = new Set<string>();
  const existingConns = await db.select().from(connections);
  for (const c of existingConns) {
    existingPairs.add(`${Math.min(c.personId1, c.personId2)}-${Math.max(c.personId1, c.personId2)}`);
  }

  for (const file of files) {
    try {
      const data: AIAnalysisResult = JSON.parse(
        fs.readFileSync(path.join(aiDir, file), "utf-8"),
      );

      // --- Persons ---
      for (const mention of data.persons) {
        const existing = await db
          .select()
          .from(persons)
          .where(sql`LOWER(${persons.name}) = LOWER(${mention.name})`)
          .limit(1);

        if (existing.length === 0) {
          const status = inferStatusFromCategory(mention.category, mention.role);
          try {
            await db.insert(persons).values({
              name: mention.name,
              category: mention.category,
              role: mention.role,
              description: (mention.context || "").substring(0, 500),
              status,
              documentCount: 0,
              connectionCount: 0,
            });
            personsLoaded++;
          } catch {
            /* skip duplicates */
          }
        }
      }

      // --- Connections ---
      for (const conn of data.connections) {
        const [person1] = await db
          .select()
          .from(persons)
          .where(sql`LOWER(${persons.name}) = LOWER(${conn.person1})`)
          .limit(1);

        const [person2] = await db
          .select()
          .from(persons)
          .where(sql`LOWER(${persons.name}) = LOWER(${conn.person2})`)
          .limit(1);

        if (person1 && person2) {
          const pairKey = `${Math.min(person1.id, person2.id)}-${Math.max(person1.id, person2.id)}`;
          if (!existingPairs.has(pairKey)) {
            try {
              await db.insert(connections).values({
                personId1: person1.id,
                personId2: person2.id,
                connectionType: conn.relationshipType,
                description: (conn.description || "").substring(0, 500),
                strength: conn.strength,
              });
              existingPairs.add(pairKey);
              connectionsLoaded++;
            } catch {
              /* skip */
            }
          }
        }
      }

      // --- Events ---
      for (const event of data.events) {
        try {
          // Check for existing event with same date + title
          const existingEvent = await db
            .select({ id: timelineEvents.id })
            .from(timelineEvents)
            .where(sql`${timelineEvents.date} = ${event.date} AND LOWER(${timelineEvents.title}) = LOWER(${event.title})`)
            .limit(1);

          if (existingEvent.length > 0) continue;

          const personIds: number[] = [];
          for (const name of event.personsInvolved) {
            const [p] = await db
              .select()
              .from(persons)
              .where(sql`LOWER(${persons.name}) = LOWER(${name})`)
              .limit(1);
            if (p) personIds.push(p.id);
          }

          await db.insert(timelineEvents).values({
            date: event.date,
            title: event.title,
            description: event.description,
            category: event.category,
            significance: event.significance,
            personIds,
          });
          eventsLoaded++;
        } catch {
          /* skip duplicates */
        }
      }

      // --- Person↔Document links ---
      for (const mention of data.persons) {
        const [person] = await db
          .select()
          .from(persons)
          .where(sql`LOWER(${persons.name}) = LOWER(${mention.name})`)
          .limit(1);

        if (!person) continue;

        // Try to find document by fileName match
        const efta = data.fileName.replace(/\.json$/i, "").replace(/\.pdf$/i, "");
        const [doc] = await db
          .select()
          .from(documents)
          .where(sql`${documents.title} ILIKE ${'%' + efta + '%'} OR ${documents.sourceUrl} ILIKE ${'%' + efta + '%'}`)
          .limit(1);

        if (doc) {
          const existingLink = await db
            .select()
            .from(personDocuments)
            .where(sql`${personDocuments.personId} = ${person.id} AND ${personDocuments.documentId} = ${doc.id}`)
            .limit(1);

          if (existingLink.length === 0) {
            try {
              await db.insert(personDocuments).values({
                personId: person.id,
                documentId: doc.id,
                context: (mention.context || "").substring(0, 500),
              });
              docLinksCreated++;
            } catch {
              /* skip */
            }
          }
        }
      }
    } catch (error: any) {
      console.warn(`  Error processing ${file}: ${error.message}`);
    }
  }

  console.log(`  AI Results loaded: ${personsLoaded} persons, ${connectionsLoaded} connections, ${eventsLoaded} events, ${docLinksCreated} document links`);
  return { persons: personsLoaded, connections: connectionsLoaded, events: eventsLoaded, docLinks: docLinksCreated };
}

function inferStatusFromCategory(category: string, role: string): string {
  const lower = `${category} ${role}`.toLowerCase();
  if (lower.includes("victim")) return "victim";
  if (lower.includes("convicted") || lower.includes("defendant")) return "convicted";
  if (lower.includes("witness")) return "named";
  return "named";
}

export async function updateDocumentCounts(): Promise<void> {
  console.log("Updating document and connection counts...");

  const allPersons = await db.select().from(persons);

  for (const person of allPersons) {
    const [docCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(personDocuments)
      .where(eq(personDocuments.personId, person.id));

    const [connCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(connections)
      .where(sql`${connections.personId1} = ${person.id} OR ${connections.personId2} = ${person.id}`);

    await db
      .update(persons)
      .set({
        documentCount: docCount?.count || person.documentCount || 0,
        connectionCount: connCount?.count || person.connectionCount || 0,
      })
      .where(eq(persons.id, person.id));
  }

  console.log("  Counts updated");
}

export async function deduplicatePersonsInDB(): Promise<void> {
  console.log("Deduplicating persons in database...");

  const allPersons = await db.select().from(persons);
  console.log(`  Found ${allPersons.length} persons total`);

  // Union-Find for grouping
  const parent = new Map<number, number>();
  for (const p of allPersons) parent.set(p.id, p.id);

  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Compare all pairs
  for (let i = 0; i < allPersons.length; i++) {
    for (let j = i + 1; j < allPersons.length; j++) {
      if (isSamePerson(allPersons[i], allPersons[j])) {
        union(allPersons[i].id, allPersons[j].id);
      }
    }
  }

  // Extract groups
  const groups = new Map<number, typeof allPersons>();
  for (const p of allPersons) {
    const root = find(p.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(p);
  }

  let mergedCount = 0;
  let deletedCount = 0;

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    // Pick canonical: most connections + documents
    group.sort((a, b) => (b.connectionCount + b.documentCount) - (a.connectionCount + a.documentCount));
    const canonical = group[0];
    const duplicateIds = group.slice(1).map(p => p.id);

    if (duplicateIds.length === 0) continue;

    // Remap person_documents
    await db.update(personDocuments)
      .set({ personId: canonical.id })
      .where(inArray(personDocuments.personId, duplicateIds));

    // Remap connections (personId1)
    await db.update(connections)
      .set({ personId1: canonical.id })
      .where(inArray(connections.personId1, duplicateIds));

    // Remap connections (personId2)
    await db.update(connections)
      .set({ personId2: canonical.id })
      .where(inArray(connections.personId2, duplicateIds));

    // Delete duplicate person records
    await db.delete(persons).where(inArray(persons.id, duplicateIds));

    // Update canonical counts
    const [docCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(personDocuments)
      .where(eq(personDocuments.personId, canonical.id));

    const [connCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(connections)
      .where(sql`${connections.personId1} = ${canonical.id} OR ${connections.personId2} = ${canonical.id}`);

    await db.update(persons)
      .set({
        documentCount: docCount?.count || 0,
        connectionCount: connCount?.count || 0,
      })
      .where(eq(persons.id, canonical.id));

    mergedCount++;
    deletedCount += duplicateIds.length;
    console.log(`  Merged "${group.map(p => p.name).join('", "')}" → "${canonical.name}"`);
  }

  // Remove self-loop connections created by merging
  await db.execute(sql`DELETE FROM ${connections} WHERE ${connections.personId1} = ${connections.personId2}`);

  console.log(`  Merged ${mergedCount} groups, deleted ${deletedCount} duplicate persons`);
}

function inferDocumentType(description: string): string {
  const lower = description.toLowerCase();
  if (/flight log|flight manifest|passenger/i.test(lower)) return "flight log";
  if (/deposition|testimony|deposed/i.test(lower)) return "deposition";
  if (/court|filing|indictment|grand jury|warrant/i.test(lower)) return "court filing";
  if (/fbi|302|interview|investigation/i.test(lower)) return "fbi report";
  if (/email|correspondence|communication/i.test(lower)) return "email";
  if (/photo|image|video|visual|media/i.test(lower)) return "photograph";
  if (/financial|bank|wire|transfer|payment/i.test(lower)) return "financial record";
  if (/contact|address|phone/i.test(lower)) return "contact list";
  if (/surveillance|camera|footage/i.test(lower)) return "surveillance";
  if (/property|island|search|raid/i.test(lower)) return "property record";
  return "government record";
}

function mapFileTypeToDocType(fileType: string): string {
  const map: Record<string, string> = {
    "pdf": "government record",
    "jpg": "photograph",
    "jpeg": "photograph",
    "png": "photograph",
    "gif": "photograph",
    "mp4": "video",
    "avi": "video",
    "mov": "video",
    "doc": "government record",
    "docx": "government record",
    "xls": "financial record",
    "xlsx": "financial record",
    "csv": "financial record",
    "txt": "government record",
  };
  return map[fileType.toLowerCase()] || "government record";
}

function inferTags(description: string): string[] {
  const tags: string[] = [];
  const lower = description.toLowerCase();

  if (/fbi/i.test(lower)) tags.push("FBI");
  if (/flight/i.test(lower)) tags.push("flight logs");
  if (/email|correspondence/i.test(lower)) tags.push("correspondence");
  if (/photo|image/i.test(lower)) tags.push("photographs");
  if (/video/i.test(lower)) tags.push("video");
  if (/financial|bank|wire/i.test(lower)) tags.push("financial");
  if (/court|legal|filing/i.test(lower)) tags.push("court records");
  if (/property|island/i.test(lower)) tags.push("property");
  if (/surveillance/i.test(lower)) tags.push("surveillance");
  if (/victim/i.test(lower)) tags.push("victim statements");
  if (/redact/i.test(lower)) tags.push("redacted");

  return tags.length > 0 ? tags : ["DOJ disclosure"];
}

export async function importDownloadedFiles(downloadDir?: string): Promise<number> {
  const baseDir = downloadDir || path.join(DATA_DIR, "downloads");

  if (!fs.existsSync(baseDir)) {
    console.error(`Download directory not found: ${baseDir}`);
    return 0;
  }

  const urlsDir = path.join(baseDir, "urls");
  let loaded = 0;
  let skipped = 0;

  const dataSets = fs.readdirSync(baseDir)
    .filter(d => d.startsWith("data-set-") && fs.statSync(path.join(baseDir, d)).isDirectory())
    .sort();

  console.log(`Found ${dataSets.length} data set directories in ${baseDir}`);

  for (const dsDir of dataSets) {
    const dsMatch = dsDir.match(/data-set-(\d+)/);
    if (!dsMatch) continue;
    const dsNum = parseInt(dsMatch[1], 10);

    const dsPath = path.join(baseDir, dsDir);
    const files = fs.readdirSync(dsPath).filter(f => f.toLowerCase().endsWith(".pdf"));

    const urlsFile = path.join(urlsDir, `data-set-${dsNum}-urls.txt`);
    const urlMap = new Map<string, string>();
    if (fs.existsSync(urlsFile)) {
      const urls = fs.readFileSync(urlsFile, "utf-8").split("\n").filter(Boolean);
      for (const url of urls) {
        const fname = url.split("/").pop() || "";
        const decoded = decodeURIComponent(fname);
        urlMap.set(decoded, url);
        urlMap.set(fname, url);
      }
    }

    const dsInfo = KNOWN_DATA_SET_INFO[dsNum];
    const dsName = dsInfo?.name || `Data Set ${dsNum}`;
    const dsDesc = dsInfo?.description || `DOJ Epstein disclosure files from Data Set ${dsNum}`;

    console.log(`  Processing ${dsName}: ${files.length} PDF files...`);

    let dsLoaded = 0;
    let dsSkipped = 0;

    for (const file of files) {
      const sourceUrl = urlMap.get(file) || `https://www.justice.gov/epstein/files/DataSet%20${dsNum}/${encodeURIComponent(file)}`;

      const existing = await db
        .select()
        .from(documents)
        .where(sql`${documents.sourceUrl} = ${sourceUrl}`)
        .limit(1);

      if (existing.length > 0) {
        // Update localPath if not already set
        const localPath = path.join(dsPath, file);
        if (!existing[0].localPath) {
          await db.update(documents)
            .set({ localPath })
            .where(eq(documents.id, existing[0].id));
        }
        skipped++;
        dsSkipped++;
        continue;
      }

      const efta = file.replace(/\.pdf$/i, "");
      const fileStat = fs.statSync(path.join(dsPath, file));
      const fileSizeKB = Math.round(fileStat.size / 1024);
      const docType = inferDocumentType(dsDesc);

      try {
        await db.insert(documents).values({
          title: `${efta} (${dsName})`,
          description: `${dsDesc}. File: ${efta}. Size: ${fileSizeKB}KB.`,
          documentType: docType,
          dataSet: String(dsNum),
          sourceUrl,
          localPath: path.join(dsPath, file),
          datePublished: "2026-01-30",
          isRedacted: true,
          tags: [`data-set-${dsNum}`, "DOJ disclosure", "PDF", docType],
        });
        loaded++;
        dsLoaded++;
      } catch (error: any) {
        if (!error.message.includes("duplicate")) {
          console.warn(`    Error loading ${file}: ${error.message}`);
        }
      }
    }

    console.log(`    ${dsName}: ${dsLoaded} loaded, ${dsSkipped} skipped`);
  }

  console.log(`\n  Total: ${loaded} new documents imported, ${skipped} skipped`);
  return loaded;
}

const KNOWN_DATA_SET_INFO: Record<number, { name: string; description: string }> = {
  1: { name: "Data Set 1", description: "FBI investigative files, flight logs, contact books, and early case documents from the Palm Beach investigation (2005-2008)" },
  2: { name: "Data Set 2", description: "FBI 302 interview reports, police reports from Palm Beach, and early correspondence between Epstein's legal team and federal prosecutors" },
  3: { name: "Data Set 3", description: "FBI investigative files including victim statements, witness interviews, and law enforcement correspondence" },
  4: { name: "Data Set 4", description: "FBI Form 302 interview summaries documenting victim statements and recruitment patterns at Epstein's properties" },
  5: { name: "Data Set 5", description: "Grand jury transcripts, SDNY investigation documents, and indictment materials from the 2019 federal case" },
  6: { name: "Data Set 6", description: "Search warrant applications, property inventories from FBI raids on Manhattan mansion, Palm Beach estate, and private island" },
  7: { name: "Data Set 7", description: "Financial records including wire transfers, bank statements, and property transaction documents" },
  8: { name: "Data Set 8", description: "Surveillance footage summaries, MCC records, property records for Little St. James Island, and death investigation materials" },
  9: { name: "Data Set 9", description: "High-value communication records: private email correspondence between Epstein and prominent individuals, internal DOJ correspondence regarding the 2008 NPA" },
  10: { name: "Data Set 10", description: "Visual and forensic media: 180,000+ images and 2,000+ videos seized from Epstein's properties. Female faces redacted for victim protection" },
  11: { name: "Data Set 11", description: "Financial ledgers, additional flight manifests beyond previously published logs, and property seizure records" },
  12: { name: "Data Set 12", description: "Supplemental and late productions: approximately 150 documents requiring prolonged legal review, released January 30, 2026" },
};

export async function extractConnectionsFromDescriptions(): Promise<number> {
  console.log("Extracting connections from person descriptions...");

  const allPersons = await db.select().from(persons);
  const nameToId = new Map<string, number>();
  const nameLower = new Map<string, number>();

  for (const p of allPersons) {
    nameToId.set(p.name, p.id);
    nameLower.set(p.name.toLowerCase(), p.id);
    if (p.aliases) {
      for (const alias of p.aliases) {
        nameLower.set(alias.toLowerCase(), p.id);
      }
    }
  }

  const lastNames = new Map<string, { fullName: string; id: number }[]>();
  for (const p of allPersons) {
    const parts = p.name.split(" ");
    if (parts.length >= 2) {
      const last = parts[parts.length - 1].toLowerCase();
      if (!lastNames.has(last)) lastNames.set(last, []);
      lastNames.get(last)!.push({ fullName: p.name, id: p.id });
    }
  }

  let connectionsCreated = 0;
  const existingPairs = new Set<string>();

  const existingConns = await db.select().from(connections);
  for (const c of existingConns) {
    existingPairs.add(`${Math.min(c.personId1, c.personId2)}-${Math.max(c.personId1, c.personId2)}`);
  }

  // Collect all connection triples for potential AI classification
  const connectionTriples: {
    person1Id: number;
    person2Id: number;
    person1Name: string;
    person2Name: string;
    context: string;
  }[] = [];

  for (const person of allPersons) {
    if (!person.description) continue;
    const desc = person.description;

    for (const other of allPersons) {
      if (other.id === person.id) continue;

      const pairKey = `${Math.min(person.id, other.id)}-${Math.max(person.id, other.id)}`;
      if (existingPairs.has(pairKey)) continue;

      const otherParts = other.name.split(" ");
      let mentioned = false;

      if (desc.includes(other.name)) {
        mentioned = true;
      } else if (otherParts.length >= 2) {
        const lastName = otherParts[otherParts.length - 1];
        const firstName = otherParts[0];
        if (lastName.length > 3 && desc.includes(lastName)) {
          const lastEntries = lastNames.get(lastName.toLowerCase());
          if (lastEntries && lastEntries.length === 1) {
            mentioned = true;
          } else if (desc.includes(firstName) && desc.includes(lastName)) {
            mentioned = true;
          }
        }
      }

      if (mentioned) {
        const context = extractRelevantContext(desc, other.name);
        existingPairs.add(pairKey);
        connectionTriples.push({
          person1Id: person.id,
          person2Id: other.id,
          person1Name: person.name,
          person2Name: other.name,
          context,
        });
      }
    }
  }

  console.log(`  Found ${connectionTriples.length} potential connections`);

  // Try AI classification, fall back to regex
  const deepseek = getDeepSeek();
  if (deepseek && connectionTriples.length > 0) {
    console.log("  Using AI to classify connection types...");
    const BATCH_SIZE = 25;

    for (let i = 0; i < connectionTriples.length; i += BATCH_SIZE) {
      const batch = connectionTriples.slice(i, i + BATCH_SIZE);
      try {
        const prompt = batch.map((t, idx) => `${idx}. ${t.person1Name} ↔ ${t.person2Name}: "${t.context.substring(0, 200)}"`).join("\n");

        const response = await deepseek.chat.completions.create({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: `You are classifying connections between individuals in the Jeffrey Epstein case.

For each pair, return a JSON array with:
{
  "index": number (matching the input index),
  "connectionType": "social" | "financial" | "travel" | "legal" | "employment" | "correspondence" | "victim-related" | "political" | "associated",
  "description": "1-sentence description of the connection based on the context",
  "strength": 1-5 (1=weak mention, 3=clear connection, 5=deeply connected)
}

Respond with a JSON array only.`,
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
        });

        const text = response.choices[0]?.message?.content?.trim() || "[]";
        // Extract JSON array from response (handle markdown code blocks)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const classifications = JSON.parse(jsonMatch[0]) as {
            index: number;
            connectionType: string;
            description: string;
            strength: number;
          }[];

          for (const cls of classifications) {
            const triple = batch[cls.index];
            if (!triple) continue;

            try {
              await db.insert(connections).values({
                personId1: triple.person1Id,
                personId2: triple.person2Id,
                connectionType: cls.connectionType,
                description: cls.description.substring(0, 500),
                strength: cls.strength,
              });
              connectionsCreated++;
            } catch {
              /* skip */
            }
          }
        }
      } catch (error: any) {
        console.warn(`  AI classification failed for batch at index ${i}, falling back to regex: ${error.message}`);
        // Fall back to regex for this batch
        for (const triple of batch) {
          const { connectionType, strength } = inferRelationshipType(triple.context);
          try {
            await db.insert(connections).values({
              personId1: triple.person1Id,
              personId2: triple.person2Id,
              connectionType,
              description: triple.context.substring(0, 500),
              strength,
            });
            connectionsCreated++;
          } catch {
            /* skip */
          }
        }
      }

      if (i + BATCH_SIZE < connectionTriples.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } else {
    // No API key — use regex fallback for all
    if (connectionTriples.length > 0) {
      console.log("  No DEEPSEEK_API_KEY set, using regex classification...");
    }
    for (const triple of connectionTriples) {
      const { connectionType, strength } = inferRelationshipType(triple.context);
      try {
        await db.insert(connections).values({
          personId1: triple.person1Id,
          personId2: triple.person2Id,
          connectionType,
          description: triple.context.substring(0, 500),
          strength,
        });
        connectionsCreated++;
      } catch {
        /* skip */
      }
    }
  }

  console.log(`  Created ${connectionsCreated} new connections from descriptions`);
  return connectionsCreated;
}

function inferRelationshipType(context: string): { connectionType: string; strength: number } {
  const descLower = context.toLowerCase();
  let connectionType = "associated";
  let strength = 1;

  if (/email|wrote|messag|corresponden/i.test(descLower)) {
    connectionType = "correspondence";
    strength = 2;
  }
  if (/met with|meeting|dinner|lunch|visit/i.test(descLower)) {
    connectionType = "social";
    strength = 2;
  }
  if (/business|financial|paid|invest|fund/i.test(descLower)) {
    connectionType = "financial";
    strength = 3;
  }
  if (/flew|flight|plane|jet|travel/i.test(descLower)) {
    connectionType = "travel";
    strength = 3;
  }
  if (/island|palm beach|manhattan|residence|house|home/i.test(descLower)) {
    connectionType = "social";
    strength = 2;
  }

  return { connectionType, strength };
}

function extractRelevantContext(description: string, name: string): string {
  const sentences = description.split(/\.\s+/);
  const relevant = sentences.filter(s => s.includes(name) || s.includes(name.split(" ").pop()!));
  if (relevant.length > 0) {
    return relevant.slice(0, 2).join(". ") + ".";
  }
  return `Mentioned in connection with ${name}`;
}

if (process.argv[1]?.includes(path.basename(__filename))) {
  (async () => {
    const command = process.argv[2];

    if (command === "persons") {
      await loadPersonsFromFile(process.argv[3]);
    } else if (command === "documents") {
      await loadDocumentsFromCatalog(process.argv[3]);
    } else if (command === "ai-results") {
      await loadAIResults();
    } else if (command === "extract-connections") {
      await extractConnectionsFromDescriptions();
    } else if (command === "import-downloads") {
      await importDownloadedFiles(process.argv[3]);
    } else if (command === "update-counts") {
      await updateDocumentCounts();
    } else if (command === "dedup-persons") {
      await deduplicatePersonsInDB();
    } else if (command === "classify-media") {
      await classifyAllDocuments({
        downloadDir: process.argv[3],
        reclassify: process.argv.includes("--reclassify"),
      });
    } else {
      console.log("Usage: npx tsx scripts/pipeline/db-loader.ts <command>");
      console.log("Commands:");
      console.log("  persons [file]       - Load persons from JSON file");
      console.log("  documents [file]     - Load documents from DOJ catalog");
      console.log("  ai-results           - Load AI-analyzed persons, connections, and events");
      console.log("  import-downloads [dir] - Import downloaded PDFs from filesystem");
      console.log("  extract-connections  - Extract relationships from descriptions");
      console.log("  update-counts        - Recalculate document/connection counts");
      console.log("  dedup-persons         - Deduplicate persons in database");
      console.log("  classify-media [dir]  - Classify documents by media type (--reclassify to redo all)");
    }

    process.exit(0);
  })().catch(console.error);
}
