import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { persons, documents, connections, personDocuments, timelineEvents } from "../../shared/schema";
import { sql, eq } from "drizzle-orm";
import type { RawPerson } from "./wikipedia-scraper";
import type { DOJCatalog, DOJDataSet } from "./doj-scraper";
import type { EntityExtractionResult, ExtractedEntity, ExtractedRelationship } from "./entity-extractor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

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
    const existing = await db
      .select()
      .from(documents)
      .where(sql`LOWER(${documents.title}) = LOWER(${dataSet.name})`)
      .limit(1);

    if (existing.length > 0) continue;

    const docType = inferDocumentType(dataSet.description);

    try {
      await db.insert(documents).values({
        title: dataSet.name,
        description: dataSet.description,
        documentType: docType,
        dataSet: String(dataSet.id),
        sourceUrl: dataSet.url,
        datePublished: "2026-01-30",
        pageCount: dataSet.files.length,
        isRedacted: true,
        tags: inferTags(dataSet.description),
      });
      loaded++;
    } catch (error: any) {
      console.warn(`  Error loading data set ${dataSet.name}: ${error.message}`);
    }

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

export async function loadExtractedEntities(entitiesPath?: string): Promise<{ persons: number; connections: number }> {
  const file = entitiesPath || path.join(DATA_DIR, "entities.json");
  if (!fs.existsSync(file)) {
    console.error(`Entities file not found: ${file}`);
    return { persons: 0, connections: 0 };
  }

  const data: EntityExtractionResult = JSON.parse(fs.readFileSync(file, "utf-8"));
  console.log(`Loading ${data.persons.length} extracted persons and ${data.relationships.length} relationships...`);

  let personsLoaded = 0;
  let connectionsLoaded = 0;

  for (const entity of data.persons) {
    const existing = await db
      .select()
      .from(persons)
      .where(sql`LOWER(${persons.name}) = LOWER(${entity.name})`)
      .limit(1);

    if (existing.length === 0) {
      try {
        await db.insert(persons).values({
          name: entity.name,
          role: "Named individual",
          description: entity.contexts[0]?.substring(0, 500) || `Mentioned ${entity.mentions} times in Epstein files`,
          status: "named",
          documentCount: entity.sourceFiles.length,
          connectionCount: 0,
          category: "associate",
        });
        personsLoaded++;
      } catch {
        /* skip */
      }
    }
  }

  for (const rel of data.relationships) {
    const [person1] = await db
      .select()
      .from(persons)
      .where(sql`LOWER(${persons.name}) = LOWER(${rel.person1})`)
      .limit(1);

    const [person2] = await db
      .select()
      .from(persons)
      .where(sql`LOWER(${persons.name}) = LOWER(${rel.person2})`)
      .limit(1);

    if (person1 && person2) {
      const existingConn = await db
        .select()
        .from(connections)
        .where(sql`
          (${connections.personId1} = ${person1.id} AND ${connections.personId2} = ${person2.id})
          OR (${connections.personId1} = ${person2.id} AND ${connections.personId2} = ${person1.id})
        `)
        .limit(1);

      if (existingConn.length === 0) {
        try {
          await db.insert(connections).values({
            personId1: person1.id,
            personId2: person2.id,
            connectionType: rel.type,
            description: rel.context.substring(0, 500),
            strength: 1,
          });
          connectionsLoaded++;
        } catch {
          /* skip */
        }
      }
    }
  }

  console.log(`  Loaded ${personsLoaded} new persons, ${connectionsLoaded} new connections`);
  return { persons: personsLoaded, connections: connectionsLoaded };
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
        let connectionType = "associated";
        let strength = 1;
        const descLower = desc.toLowerCase();

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

        const context = extractRelevantContext(desc, other.name);

        try {
          await db.insert(connections).values({
            personId1: person.id,
            personId2: other.id,
            connectionType,
            description: context.substring(0, 500),
            strength,
          });
          existingPairs.add(pairKey);
          connectionsCreated++;
        } catch {
        }
      }
    }
  }

  console.log(`  Created ${connectionsCreated} new connections from descriptions`);
  return connectionsCreated;
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
    } else if (command === "entities") {
      await loadExtractedEntities(process.argv[3]);
    } else if (command === "extract-connections") {
      await extractConnectionsFromDescriptions();
    } else if (command === "update-counts") {
      await updateDocumentCounts();
    } else {
      console.log("Usage: npx tsx scripts/pipeline/db-loader.ts <command>");
      console.log("Commands:");
      console.log("  persons [file]     - Load persons from JSON file");
      console.log("  documents [file]   - Load documents from DOJ catalog");
      console.log("  entities [file]    - Load extracted entities");
      console.log("  update-counts      - Recalculate document/connection counts");
    }

    process.exit(0);
  })().catch(console.error);
}
