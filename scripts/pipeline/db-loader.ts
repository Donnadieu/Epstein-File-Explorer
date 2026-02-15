import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { db } from "../../server/db";
import { persons, documents, connections, personDocuments, timelineEvents } from "../../shared/schema";
import { sql, eq, or, inArray } from "drizzle-orm";
import { normalizeName } from "../../server/storage";
import type { RawPerson } from "./wikipedia-scraper";
import type { DOJCatalog, DOJDataSet } from "./doj-scraper";
import type { AIAnalysisResult, AIPersonMention, AIConnection, AIEvent } from "./ai-analyzer";
import { classifyAllDocuments } from "./media-classifier";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

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

  const allFiles = fs.readdirSync(aiDir).filter(f => f.endsWith(".json"));
  if (allFiles.length === 0) {
    console.log("No AI analysis results found.");
    return { persons: 0, connections: 0, events: 0, docLinks: 0 };
  }

  // Skip files whose documents are already marked as loaded
  const loadedDocs = await db.select({ title: documents.title, sourceUrl: documents.sourceUrl })
    .from(documents)
    .where(eq(documents.aiAnalysisStatus, "completed"));
  const loadedEftas = new Set<string>();
  for (const doc of loadedDocs) {
    if (doc.title) loadedEftas.add(doc.title.toLowerCase());
    if (doc.sourceUrl) loadedEftas.add(doc.sourceUrl.toLowerCase());
  }

  const files = allFiles.filter(f => {
    const efta = f.replace(/\.json$/i, "").replace(/\.pdf$/i, "").toLowerCase();
    // Check if any loaded doc title/sourceUrl contains this EFTA
    for (const key of loadedEftas) {
      if (key.includes(efta)) return false;
    }
    return true;
  });

  console.log(`Loading AI results: ${files.length} new files (${allFiles.length - files.length} already loaded, ${allFiles.length} total)`);

  let personsCreated = 0;
  let personsUpdated = 0;
  let connectionsCreated = 0;
  let eventsCreated = 0;
  let eventsUpdated = 0;
  let docLinksCreated = 0;

  const existingPairs = new Set<string>();
  const existingConns = await db.select({ personId1: connections.personId1, personId2: connections.personId2 }).from(connections);
  for (const c of existingConns) {
    existingPairs.add(`${Math.min(c.personId1, c.personId2)}-${Math.max(c.personId1, c.personId2)}`);
  }

  // Pre-load all persons by lowercase name for O(1) lookups
  console.log("  Pre-loading persons...");
  const allPersonsList = await db.select().from(persons);
  const personsByName = new Map<string, typeof persons.$inferSelect>();
  for (const p of allPersonsList) {
    personsByName.set(p.name.toLowerCase(), p);
  }
  console.log(`  Pre-loaded ${personsByName.size} persons`);

  // Pre-load personDocuments links into a Set
  console.log("  Pre-loading person↔document links...");
  const allLinks = await db.select({ personId: personDocuments.personId, documentId: personDocuments.documentId }).from(personDocuments);
  const existingLinks = new Set<string>();
  for (const l of allLinks) {
    existingLinks.add(`${l.personId}-${l.documentId}`);
  }
  console.log(`  Pre-loaded ${existingLinks.size} person↔doc links`);

  // Pre-load document EFTA→ID map for O(1) source doc resolution
  console.log("  Pre-loading EFTA→doc mappings...");
  const eftaDocs = await db.select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(sql`${documents.title} LIKE '%EFTA%'`);
  const docByEfta = new Map<string, number>();
  for (const d of eftaDocs) {
    const match = d.title?.match(/EFTA\d+/i);
    if (match) docByEfta.set(match[0].toLowerCase(), d.id);
  }
  console.log(`  Pre-loaded ${docByEfta.size} EFTA→doc mappings`);

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    if (fi % 100 === 0) {
      console.log(`  [${fi}/${files.length}] ${personsCreated}p ${connectionsCreated}c ${eventsCreated}e ${docLinksCreated}d`);
    }
    try {
      const data: AIAnalysisResult = JSON.parse(
        fs.readFileSync(path.join(aiDir, file), "utf-8"),
      );

      // --- Persons ---
      for (const mention of data.persons) {
        if (isJunkPersonName(mention.name)) continue;

        const existing = personsByName.get(mention.name.toLowerCase());

        const newDesc = (mention.context || "").substring(0, 500);
        const status = inferStatusFromCategory(mention.category, mention.role);

        if (!existing) {
          try {
            const [inserted] = await db.insert(persons).values({
              name: mention.name,
              category: mention.category,
              role: mention.role,
              description: newDesc,
              status,
              documentCount: 0,
              connectionCount: 0,
            }).returning();
            personsByName.set(inserted.name.toLowerCase(), inserted);
            personsCreated++;
          } catch {
            /* skip duplicates */
          }
        } else {
          // Update if new data is richer
          const updates: Record<string, any> = {};
          if (mention.category && (!existing.category || existing.category === "unknown")) updates.category = mention.category;
          if (mention.role && (!existing.role || existing.role === "unknown")) updates.role = mention.role;
          if (newDesc && newDesc.length > (existing.description?.length || 0)) updates.description = newDesc;
          if (status !== "named" && existing.status === "named") updates.status = status;

          if (Object.keys(updates).length > 0) {
            await db.update(persons).set(updates).where(eq(persons.id, existing.id));
            personsUpdated++;
          }
        }
      }

      // --- Connections ---
      for (const conn of data.connections) {
        const person1 = personsByName.get(conn.person1.toLowerCase());
        const person2 = personsByName.get(conn.person2.toLowerCase());

        if (person1 && person2) {
          const pairKey = `${Math.min(person1.id, person2.id)}-${Math.max(person1.id, person2.id)}`;

          if (existingPairs.has(pairKey)) continue;

          try {
            const newDesc = (conn.description || "").substring(0, 500);
            await db.insert(connections).values({
              personId1: person1.id,
              personId2: person2.id,
              connectionType: conn.relationshipType,
              description: newDesc,
              strength: conn.strength,
            });
            existingPairs.add(pairKey);
            connectionsCreated++;
          } catch {
            /* skip */
          }
        }
      }

      // --- Resolve source document ID for this analysis file ---
      const eventEfta = data.fileName.replace(/\.json$/i, "").replace(/\.pdf$/i, "");
      let sourceDocId = docByEfta.get(eventEfta.toLowerCase());
      if (sourceDocId === undefined) {
        // Fallback to DB query if not in pre-loaded map
        const [sourceDoc] = await db
          .select({ id: documents.id })
          .from(documents)
          .where(sql`${documents.title} ILIKE ${'%' + eventEfta + '%'} OR ${documents.sourceUrl} ILIKE ${'%' + eventEfta + '%'}`)
          .limit(1);
        sourceDocId = sourceDoc?.id;
      }

      // --- Events ---
      for (const event of data.events) {
        try {
          const personIds: number[] = [];
          for (const name of event.personsInvolved) {
            const p = personsByName.get(name.toLowerCase());
            if (p) personIds.push(p.id);
          }

          // Check for existing event with same date + title
          const existingEvent = await db
            .select({ id: timelineEvents.id, description: timelineEvents.description, significance: timelineEvents.significance, personIds: timelineEvents.personIds, documentIds: timelineEvents.documentIds })
            .from(timelineEvents)
            .where(sql`${timelineEvents.date} = ${event.date} AND LOWER(${timelineEvents.title}) = LOWER(${event.title})`)
            .limit(1);

          const documentIds = sourceDocId ? [sourceDocId] : [];

          if (existingEvent.length === 0) {
            await db.insert(timelineEvents).values({
              date: event.date,
              title: event.title,
              description: event.description,
              category: event.category,
              significance: event.significance,
              personIds,
              documentIds,
            });
            eventsCreated++;
          } else {
            const ex = existingEvent[0];
            const updates: Record<string, any> = {};
            if (event.description && event.description.length > (ex.description?.length || 0)) updates.description = event.description;
            if (event.category) updates.category = event.category;
            if (event.significance && event.significance > (ex.significance ?? 0)) updates.significance = event.significance;
            if (personIds.length > (ex.personIds?.length || 0)) updates.personIds = personIds;

            // Merge documentIds: add new doc ID if not already present
            if (sourceDocId) {
              const existingDocIds = ex.documentIds ?? [];
              if (!existingDocIds.includes(sourceDocId)) {
                updates.documentIds = [...existingDocIds, sourceDocId];
              }
            }

            if (Object.keys(updates).length > 0) {
              await db.update(timelineEvents).set(updates).where(eq(timelineEvents.id, ex.id));
              eventsUpdated++;
            }
          }
        } catch {
          /* skip duplicates */
        }
      }

      // --- Person↔Document links ---
      if (sourceDocId) {
        for (const mention of data.persons) {
          const person = personsByName.get(mention.name.toLowerCase());
          if (!person) continue;

          const linkKey = `${person.id}-${sourceDocId}`;
          if (existingLinks.has(linkKey)) continue;

          const newContext = (mention.context || "").substring(0, 500);
          try {
            await db.insert(personDocuments).values({
              personId: person.id,
              documentId: sourceDocId,
              context: newContext,
            });
            existingLinks.add(linkKey);
            docLinksCreated++;
          } catch {
            /* skip */
          }
        }
      }
      // --- Mark document as AI-analyzed ---
      if (sourceDocId) {
        await db.update(documents)
          .set({ aiAnalysisStatus: "completed" })
          .where(eq(documents.id, sourceDocId));
      }

    } catch (error: any) {
      console.warn(`  Error processing ${file}: ${error.message}`);
    }
  }

  console.log(`  AI Results: ${personsCreated} persons created, ${personsUpdated} updated | ${connectionsCreated} connections created (dupes skipped) | ${eventsCreated} events created, ${eventsUpdated} updated | ${docLinksCreated} doc-links created`);
  return { persons: personsCreated + personsUpdated, connections: connectionsCreated, events: eventsCreated + eventsUpdated, docLinks: docLinksCreated };
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

/**
 * Merge a list of duplicate person IDs into a canonical person.
 * Remaps person_documents, connections, timeline_events, collects aliases,
 * deduplicates person_documents rows, removes self-loop connections, and recalculates counts.
 */
async function mergePersonGroup(canonical: typeof persons.$inferSelect, duplicateIds: number[], allNames: string[]): Promise<void> {
  if (duplicateIds.length === 0) return;

  // Collect variant names as aliases (exclude canonical's own name)
  const existingAliases = canonical.aliases ?? [];
  const newAliases = allNames
    .filter(n => n !== canonical.name && !existingAliases.includes(n))
    .slice(0, 20); // cap to avoid bloat

  // Remap person_documents
  await db.update(personDocuments)
    .set({ personId: canonical.id })
    .where(inArray(personDocuments.personId, duplicateIds));

  // Dedup person_documents: remove duplicate (personId, documentId) rows keeping the first
  await db.execute(sql`
    DELETE FROM person_documents a USING person_documents b
    WHERE a.id > b.id
      AND a.person_id = b.person_id
      AND a.document_id = b.document_id
      AND a.person_id = ${canonical.id}
  `);

  // Remap connections
  await db.update(connections)
    .set({ personId1: canonical.id })
    .where(inArray(connections.personId1, duplicateIds));
  await db.update(connections)
    .set({ personId2: canonical.id })
    .where(inArray(connections.personId2, duplicateIds));

  // Remove self-loop connections created by remapping
  await db.execute(sql`DELETE FROM connections WHERE person_id_1 = person_id_2`);

  // Delete any remaining connections still referencing duplicate IDs (safety net for FK constraints)
  await db.delete(connections).where(
    or(
      inArray(connections.personId1, duplicateIds),
      inArray(connections.personId2, duplicateIds),
    )
  );

  // Remap timeline_events.person_ids (integer array)
  for (const dupId of duplicateIds) {
    await db.execute(sql`
      UPDATE timeline_events
      SET person_ids = array_replace(person_ids, ${dupId}, ${canonical.id})
      WHERE ${dupId} = ANY(person_ids)
    `);
  }
  // Deduplicate person_ids arrays (remove duplicate canonical IDs)
  await db.execute(sql`
    UPDATE timeline_events
    SET person_ids = (SELECT array_agg(DISTINCT x) FROM unnest(person_ids) x)
    WHERE ${canonical.id} = ANY(person_ids)
  `);

  // Delete any remaining person_documents referencing duplicates (safety net)
  await db.delete(personDocuments).where(inArray(personDocuments.personId, duplicateIds));

  // Delete duplicate person records
  await db.delete(persons).where(inArray(persons.id, duplicateIds));

  // Update canonical: counts + aliases
  const [docCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(personDocuments)
    .where(eq(personDocuments.personId, canonical.id));
  const [connCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(connections)
    .where(sql`${connections.personId1} = ${canonical.id} OR ${connections.personId2} = ${canonical.id}`);

  const mergedAliases = [...new Set([...existingAliases, ...newAliases])];
  await db.update(persons)
    .set({
      documentCount: docCount?.count || 0,
      connectionCount: connCount?.count || 0,
      aliases: mergedAliases.length > 0 ? mergedAliases : null,
    })
    .where(eq(persons.id, canonical.id));
}

/**
 * Returns true if a person name is junk (OCR artifact, generic role, placeholder, etc.)
 * and should be removed from the database entirely.
 */
export function isJunkPersonName(name: string): boolean {
  const trimmed = name.trim();

  // Very short names (1-2 chars)
  if (trimmed.length <= 2) return true;

  // Long descriptive strings (>60 chars are not person names)
  if (trimmed.length > 60) return true;

  // Contains special characters that don't appear in real names (including OCR artifacts)
  if (/[!;&$%^°•\\*<>]/.test(trimmed)) return true;

  // Contains slashes (role combos, OCR junk)
  if (trimmed.includes("/")) return true;

  // Multiple consecutive digits (EFTA numbers, codes, OCR garbage)
  if (/[0-9]{2,}/.test(trimmed)) return true;

  // Digits mixed with letters in garbled patterns (e.g. "Donald Po4lon", "I3aktaj")
  if (/[0-9].*[a-zA-Z].*[0-9]/.test(trimmed)) return true;
  if (/^[A-Z][a-z]*[0-9][a-z]/.test(trimmed)) return true;

  // Bracketed text: [REDACTED], [redacted], etc.
  if (/^\[.*\]$/.test(trimmed)) return true;

  // All-caps abbreviations without spaces (USANYS, ASAC, AUSAMMI, etc.)
  if (/^[A-Z]{4,}$/.test(trimmed)) return true;

  // Generic role-as-name entries (exact matches)
  const GENERIC_ROLES = new Set([
    "assistant united states attorney",
    "special agent",
    "case agent name",
    "correctional officer",
    "attorney general",
    "unit manager",
    "senior inspector",
    "supervisory inspector",
    "fbi assistant director",
    "deputy united states attorney",
    "supervisory staff attorney clc",
    "unknown recipient",
    "unknown sender",
    "institution duty officer",
    "victim witness coordinator",
    "day watch shu officer in charge",
    "evening watch shu officer in charge",
    "u.s. attorney",
    "assistant u.s. attorney",
  ]);
  if (GENERIC_ROLES.has(trimmed.toLowerCase())) return true;

  // Pattern-based junk
  const lower = trimmed.toLowerCase();

  // "Epstein's X" placeholders
  if (/^epstein's\s/i.test(trimmed)) return true;

  // "Epstein victim" placeholder
  if (lower === "epstein victim") return true;

  // Victim-N, Minor Victim-N patterns
  if (/^(minor\s+)?victim-\d/i.test(trimmed)) return true;

  // "Unknown X" / "Unnamed X" placeholders
  if (/^unknown\s/i.test(trimmed) || /^unnamed\s/i.test(trimmed)) return true;

  // "Mr./Mrs./Ms./Dr. [Redacted]" or "Mr./Mrs./Ms./Dr." with single word after
  if (/^(mr|mrs|ms|dr)\.\s*\[/i.test(trimmed)) return true;

  // Title-only entries like "Mr." or "Dr." with nothing substantial after
  if (/^(mr|mrs|ms|dr|lt|sgt|det|cap)\.\s*$/i.test(trimmed)) return true;

  // Single word, 3 chars or fewer (Des, Her, Ann, Bob, etc. are not useful without last names)
  if (!/\s/.test(trimmed) && trimmed.length <= 3) return true;

  // All-caps 3-letter codes without spaces (LSJ, AUS, DAG, DAC, CDR, FCA, etc.)
  if (/^[A-Z]{3}$/.test(trimmed)) return true;

  // Known generic non-person entries
  const GENERIC_NONPERSONS = new Set([
    "bop employee",
    "the court",
    "union president",
    "flight engineer",
    "customs officer",
    "co-pilot",
  ]);
  if (GENERIC_NONPERSONS.has(lower)) return true;

  // Pronouns and fragments used as names
  if (["her", "his", "him", "she", "he", "des", "ands"].includes(lower)) return true;

  // Organizations (LLC, Inc, Corp, LLP) — not persons
  if (/,?\s*(llc|inc|corp|lp|llp)\.?\s*$/i.test(trimmed)) return true;

  // Possessive patterns ("Employee's Name", "Epstein's Butler")
  if (/'s\s/.test(trimmed)) return true;

  // "The X" titles ("The Ambassador", "The Government")
  if (/^the\s/i.test(trimmed)) return true;

  // "Former X" descriptions ("Former SigNet Employee")
  if (/^former\s/i.test(trimmed)) return true;

  // "Chief/Director/Head of..." titles
  if (/^(chief|director|head|commissioner|superintendent|warden|commander)\s/i.test(trimmed) && /\bof\b/i.test(trimmed)) return true;

  // "Deputy/Assistant [title]" roles
  if (/^(deputy|assistant|associate|acting|interim)\s+(assistant\s+)?(attorney general|director|chief|commissioner|warden|prosecutor|counsel)/i.test(trimmed)) return true;

  // Parenthetical org tags: (FBI), (ODAG), (AUSA), (USMS), (NY), (SI), etc.
  if (/\([A-Z]{2,5}\)/.test(trimmed)) return true;

  // "AUSA ..." prefix (Assistant US Attorney + name fragment)
  if (/^ausa\s/i.test(trimmed)) return true;

  // Placeholder patterns: OFFICER N, Inmate N, CO Rookie N
  if (/^(officer|inmate|co\s+rookie)\s+\d/i.test(trimmed)) return true;

  // John/Jane Doe (with optional number/suffix)
  if (/^(john|jane)\s+doe/i.test(trimmed)) return true;

  // Title + single initial: "Mr. M", "Dr. S.", "Ms. M", "Dr. B."
  if (/^(mr|mrs|ms|dr)\.\s+[A-Z]\.?\s*$/i.test(trimmed)) return true;

  // "Declarant" prefix
  if (/^declarant/i.test(trimmed)) return true;

  // Comma-digit patterns: "InEir, 3 Unit Manager", "M, 1"
  if (/,\s*\d/.test(trimmed)) return true;

  return false;
}

/**
 * Load Wikipedia key figures from persons-raw.json into a Set of normalized names.
 * These persons are "protected" and should never be deleted.
 */
function loadProtectedNames(): Set<string> {
  const protectedFile = path.join(DATA_DIR, "persons-raw.json");
  const protectedNames = new Set<string>();
  if (fs.existsSync(protectedFile)) {
    const raw = JSON.parse(fs.readFileSync(protectedFile, "utf-8"));
    for (const p of raw) protectedNames.add(normalizeName(p.name));
    console.log(`  Loaded ${protectedNames.size} protected person names from Wikipedia`);
  } else {
    console.log("  Warning: persons-raw.json not found, no protected names loaded");
  }
  return protectedNames;
}

/**
 * Cascade-delete a list of person IDs: removes connections, person_documents,
 * cleans timeline_events arrays, and deletes the persons. Chunked at 500.
 */
async function deletePersonsCascade(ids: number[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await db.delete(connections).where(
      or(inArray(connections.personId1, chunk), inArray(connections.personId2, chunk))
    );
    await db.delete(personDocuments).where(inArray(personDocuments.personId, chunk));
    for (const id of chunk) {
      await db.execute(sql`
        UPDATE timeline_events
        SET person_ids = array_remove(person_ids, ${id})
        WHERE ${id} = ANY(person_ids)
      `);
    }
    await db.delete(persons).where(inArray(persons.id, chunk));
  }
}

/**
 * Select the best canonical person from a group.
 * Priority: protected > no-comma > non-ALL-CAPS > more word parts > longer name > lowest ID.
 */
function pickCanonical(
  group: (typeof persons.$inferSelect)[],
  protectedNames: Set<string>,
): typeof persons.$inferSelect {
  return [...group].sort((a, b) => {
    const protA = protectedNames.has(normalizeName(a.name)) ? 1 : 0;
    const protB = protectedNames.has(normalizeName(b.name)) ? 1 : 0;
    if (protB !== protA) return protB - protA;
    const commaA = a.name.includes(",") ? 1 : 0;
    const commaB = b.name.includes(",") ? 1 : 0;
    if (commaA !== commaB) return commaA - commaB;
    const capsA = a.name === a.name.toUpperCase() ? 1 : 0;
    const capsB = b.name === b.name.toUpperCase() ? 1 : 0;
    if (capsA !== capsB) return capsA - capsB;
    const partsA = normalizeName(a.name).split(" ").filter(p => p.length >= 2);
    const partsB = normalizeName(b.name).split(" ").filter(p => p.length >= 2);
    if (partsB.length !== partsA.length) return partsB.length - partsA.length;
    if (b.name.length !== a.name.length) return b.name.length - a.name.length;
    return a.id - b.id;
  })[0];
}

// --- Pass 0: Junk Removal ---
async function pass0JunkRemoval(protectedNames: Set<string>): Promise<number> {
  const allPersons = await db.select().from(persons);
  const junkIds: number[] = [];
  for (const p of allPersons) {
    if (isJunkPersonName(p.name)) {
      if (protectedNames.has(normalizeName(p.name))) {
        console.log(`  PROTECTED: Skipping junk-deletion of "${p.name}"`);
        continue;
      }
      junkIds.push(p.id);
    }
  }
  if (junkIds.length > 0) {
    await deletePersonsCascade(junkIds);
  }
  console.log(`  Pass 0: Removed ${junkIds.length} junk persons`);
  return junkIds.length;
}

// --- Pass 1: Exact Normalized Matches ---
async function pass1ExactNormalized(protectedNames: Set<string>): Promise<number> {
  const allPersons = await db.select().from(persons);
  const groups = new Map<string, (typeof persons.$inferSelect)[]>();
  for (const p of allPersons) {
    const norm = normalizeName(p.name);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(p);
  }

  let merged = 0;
  for (const [norm, group] of groups) {
    if (group.length <= 1) continue;
    const canonical = pickCanonical(group, protectedNames);
    const duplicateIds = group.filter(p => p.id !== canonical.id).map(p => p.id);
    await mergePersonGroup(canonical, duplicateIds, group.map(p => p.name));
    merged += duplicateIds.length;
    console.log(`  [P1] Merged ${group.map(p => `"${p.name}"`).join(", ")} → "${canonical.name}"`);
  }
  console.log(`  Pass 1: Merged ${merged} persons via exact normalized match`);
  return merged;
}

// --- Pass 2: Single-Word → Dominant Multi-Word (Evidence-Based) ---
async function pass2SingleWordEvidence(protectedNames: Set<string>): Promise<number> {
  const allPersons = await db.select().from(persons);

  // Pre-load document sets per person for evidence scoring
  const allPD = await db.select({ personId: personDocuments.personId, documentId: personDocuments.documentId }).from(personDocuments);
  const docsByPerson = new Map<number, Set<number>>();
  for (const pd of allPD) {
    if (!docsByPerson.has(pd.personId)) docsByPerson.set(pd.personId, new Set());
    docsByPerson.get(pd.personId)!.add(pd.documentId);
  }

  // Pre-load connection sets per person
  const allConns = await db.select({ p1: connections.personId1, p2: connections.personId2 }).from(connections);
  const connsByPerson = new Map<number, Set<number>>();
  for (const c of allConns) {
    if (!connsByPerson.has(c.p1)) connsByPerson.set(c.p1, new Set());
    connsByPerson.get(c.p1)!.add(c.p2);
    if (!connsByPerson.has(c.p2)) connsByPerson.set(c.p2, new Set());
    connsByPerson.get(c.p2)!.add(c.p1);
  }

  const multiWord = allPersons.filter(p => {
    const parts = normalizeName(p.name).split(" ").filter(pt => pt.length >= 2);
    return parts.length >= 2;
  });
  const singleWord = allPersons.filter(p => {
    const parts = normalizeName(p.name).split(" ").filter(pt => pt.length >= 2);
    return parts.length === 1;
  });

  // Index multi-word persons by each word part for fast lookup
  const wordIndex = new Map<string, (typeof persons.$inferSelect)[]>();
  for (const p of multiWord) {
    const parts = normalizeName(p.name).split(" ").filter(pt => pt.length >= 2);
    for (const part of parts) {
      if (!wordIndex.has(part)) wordIndex.set(part, []);
      wordIndex.get(part)!.push(p);
    }
  }

  let merged = 0;
  const mergedSingleIds = new Set<number>();

  for (const single of singleWord) {
    const norm = normalizeName(single.name);
    const word = norm.split(" ").filter(pt => pt.length >= 2)[0];
    if (!word || word.length < 3) continue;

    // Find multi-word candidates containing this word
    const candidates = wordIndex.get(word) || [];
    if (candidates.length === 0) continue;

    // Score by shared evidence
    const singleDocs = docsByPerson.get(single.id) || new Set();
    const singleConns = connsByPerson.get(single.id) || new Set();

    const scored = candidates.map(c => {
      const cDocs = docsByPerson.get(c.id) || new Set();
      const cConns = connsByPerson.get(c.id) || new Set();
      let sharedDocs = 0;
      for (const d of singleDocs) if (cDocs.has(d)) sharedDocs++;
      let sharedConns = 0;
      for (const cn of singleConns) if (cConns.has(cn)) sharedConns++;
      return { person: c, score: sharedDocs * 2 + sharedConns };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    if (scored.length === 0) continue;

    let winner: typeof persons.$inferSelect | null = null;
    if (scored.length === 1) {
      // ONLY_MATCH: exactly one scored candidate
      winner = scored[0].person;
    } else if (scored[0].score >= 2 * scored[1].score) {
      // CLEAR_WINNER: top >= 2x second
      winner = scored[0].person;
    } else {
      console.log(`  [P2] Skipping "${single.name}" → ambiguous: "${scored[0].person.name}" (${scored[0].score}) vs "${scored[1].person.name}" (${scored[1].score})`);
      continue;
    }

    try {
      await mergePersonGroup(winner, [single.id], [single.name]);
      mergedSingleIds.add(single.id);
      merged++;
      console.log(`  [P2] Merged "${single.name}" → "${winner.name}" (score: ${scored[0].score})`);
    } catch (err: any) {
      console.warn(`  [P2] Failed to merge "${single.name}": ${err.message}`);
    }
  }
  console.log(`  Pass 2: Merged ${merged} single-word persons via shared evidence`);
  return merged;
}

// --- Pass 3: Delete Remaining Single-Word Names ---
async function pass3DeleteSingleWord(protectedNames: Set<string>): Promise<number> {
  const allPersons = await db.select().from(persons);
  const toDelete = allPersons.filter(p => {
    if (protectedNames.has(normalizeName(p.name))) return false;
    const norm = normalizeName(p.name);
    const meaningfulParts = norm.split(" ").filter(pt => pt.length >= 2);
    return meaningfulParts.length <= 1 && norm.length > 0;
  });

  if (toDelete.length > 0) {
    await deletePersonsCascade(toDelete.map(p => p.id));
  }
  console.log(`  Pass 3: Deleted ${toDelete.length} remaining single-word names`);
  return toDelete.length;
}

// --- Pass 4: Key Figure Variants (Hardcoded) ---
const KEY_FIGURE_MERGES: { canonical: string; variants: string[]; deleteNames?: string[] }[] = [
  {
    canonical: "Jeffrey Epstein",
    variants: ["Jeffrey E. Epstein", "Jeffrey Edward Epstein", "Jeffery Epstein", "Jeff Epstein", "JEFFREY EPSTEIN", "JEFFREY E. EPSTEIN", "Epstein, Jeffrey"],
  },
  {
    canonical: "Ghislaine Maxwell",
    variants: ["Ghislaine Noelle Maxwell", "GHISLAINE MAXWELL", "Ghislaine N. Maxwell", "Maxwell, Ghislaine", "G. Maxwell"],
    deleteNames: ["Ghisiaine Maxwell", "Ghislane Maxwell", "Ghislaine Maxwel"],
  },
  {
    canonical: "Alexander Acosta",
    variants: ["R. Alexander Acosta", "R Alexander Acosta", "ALEXANDER ACOSTA"],
  },
  {
    canonical: "Alan Dershowitz",
    variants: ["Alan M. Dershowitz", "Alan Morton Dershowitz", "ALAN DERSHOWITZ", "Dershowitz, Alan"],
  },
  {
    canonical: "Les Wexner",
    variants: ["Leslie Wexner", "Leslie H. Wexner", "Leslie Herbert Wexner", "LES WEXNER"],
  },
  {
    canonical: "Bill Clinton",
    variants: ["William Jefferson Clinton", "William J. Clinton", "President Clinton", "BILL CLINTON", "Clinton, Bill"],
  },
  {
    canonical: "Donald Trump",
    variants: ["Donald J. Trump", "Donald John Trump", "DONALD TRUMP", "Trump, Donald"],
  },
  {
    canonical: "Virginia Giuffre",
    variants: ["Virginia Roberts", "Virginia Roberts Giuffre", "Virginia L. Giuffre", "VIRGINIA GIUFFRE", "Virginia Louise Giuffre"],
  },
  {
    canonical: "Jean-Luc Brunel",
    variants: ["Jean Luc Brunel", "JEAN-LUC BRUNEL", "Jean-Luc Bruno", "Brunel, Jean-Luc"],
  },
  {
    canonical: "Nadia Marcinkova",
    variants: ["Nadia Marcinko", "NADIA MARCINKOVA", "Nadia Marcinková"],
  },
  {
    canonical: "Mark Epstein",
    variants: ["MARK EPSTEIN", "Epstein, Mark"],
  },
  {
    canonical: "Anne Maxwell",
    variants: ["ANNE MAXWELL"],
  },
  {
    canonical: "Christine Maxwell",
    variants: ["CHRISTINE MAXWELL"],
  },
  {
    canonical: "Isabel Maxwell",
    variants: ["ISABEL MAXWELL"],
  },
];

async function pass4KeyFigures(): Promise<number> {
  let total = 0;
  for (const entry of KEY_FIGURE_MERGES) {
    // Find canonical in DB
    const [canonicalRow] = await db.select().from(persons)
      .where(sql`LOWER(${persons.name}) = LOWER(${entry.canonical})`)
      .limit(1);
    if (!canonicalRow) continue;

    // Merge variants
    for (const variant of entry.variants) {
      const [variantRow] = await db.select().from(persons)
        .where(sql`LOWER(${persons.name}) = LOWER(${variant})`)
        .limit(1);
      if (variantRow && variantRow.id !== canonicalRow.id) {
        await mergePersonGroup(canonicalRow, [variantRow.id], [variantRow.name]);
        total++;
        console.log(`  [P4] Merged "${variantRow.name}" → "${canonicalRow.name}"`);
      }
    }

    // Delete junk variants
    if (entry.deleteNames) {
      const deleteIds: number[] = [];
      for (const name of entry.deleteNames) {
        const [row] = await db.select().from(persons)
          .where(sql`LOWER(${persons.name}) = LOWER(${name})`)
          .limit(1);
        if (row && row.id !== canonicalRow.id) deleteIds.push(row.id);
      }
      if (deleteIds.length > 0) {
        await deletePersonsCascade(deleteIds);
        total += deleteIds.length;
        console.log(`  [P4] Deleted ${deleteIds.length} junk variants of "${entry.canonical}"`);
      }
    }
  }
  console.log(`  Pass 4: Processed ${total} key figure variants`);
  return total;
}

// --- Pass 5: Middle-Initial Variants ---
async function pass5MiddleInitial(protectedNames: Set<string>): Promise<number> {
  const allPersons = await db.select().from(persons);

  // Group by (first, last) words of normalized name
  const twoWordPersons: (typeof persons.$inferSelect)[] = [];
  const threeWordPersons: (typeof persons.$inferSelect)[] = [];

  for (const p of allPersons) {
    const parts = normalizeName(p.name).split(" ").filter(pt => pt.length >= 2);
    if (parts.length === 2) twoWordPersons.push(p);
    else if (parts.length >= 3) threeWordPersons.push(p);
  }

  // Index 3+-word persons by (first, last) key
  const threeWordIndex = new Map<string, (typeof persons.$inferSelect)[]>();
  for (const p of threeWordPersons) {
    const parts = normalizeName(p.name).split(" ").filter(pt => pt.length >= 2);
    const key = `${parts[0]}|${parts[parts.length - 1]}`;
    if (!threeWordIndex.has(key)) threeWordIndex.set(key, []);
    threeWordIndex.get(key)!.push(p);
  }

  let merged = 0;
  for (const twoWord of twoWordPersons) {
    const parts = normalizeName(twoWord.name).split(" ").filter(pt => pt.length >= 2);
    if (parts.length !== 2) continue;
    const key = `${parts[0]}|${parts[1]}`;
    const matches = threeWordIndex.get(key);
    if (!matches || matches.length !== 1) {
      if (matches && matches.length > 1) {
        console.log(`  [P5] Skipping "${twoWord.name}" → ambiguous: ${matches.map(m => `"${m.name}"`).join(", ")}`);
      }
      continue;
    }

    const match = matches[0];

    // Pre-load counts for both to pick canonical with more data
    const [twoDocs] = await db.select({ count: sql<number>`count(*)::int` }).from(personDocuments).where(eq(personDocuments.personId, twoWord.id));
    const [twoConns] = await db.select({ count: sql<number>`count(*)::int` }).from(connections).where(sql`${connections.personId1} = ${twoWord.id} OR ${connections.personId2} = ${twoWord.id}`);
    const [matchDocs] = await db.select({ count: sql<number>`count(*)::int` }).from(personDocuments).where(eq(personDocuments.personId, match.id));
    const [matchConns] = await db.select({ count: sql<number>`count(*)::int` }).from(connections).where(sql`${connections.personId1} = ${match.id} OR ${connections.personId2} = ${match.id}`);

    const twoTotal = (twoDocs?.count || 0) + (twoConns?.count || 0);
    const matchTotal = (matchDocs?.count || 0) + (matchConns?.count || 0);

    let canonical: typeof persons.$inferSelect;
    let duplicate: typeof persons.$inferSelect;
    if (twoTotal >= matchTotal) {
      canonical = twoWord;
      duplicate = match;
    } else {
      canonical = match;
      duplicate = twoWord;
    }
    // Tiebreak: lowest ID
    if (twoTotal === matchTotal) {
      canonical = twoWord.id < match.id ? twoWord : match;
      duplicate = canonical.id === twoWord.id ? match : twoWord;
    }

    try {
      await mergePersonGroup(canonical, [duplicate.id], [duplicate.name]);
      merged++;
      console.log(`  [P5] Merged "${duplicate.name}" → "${canonical.name}"`);
    } catch (err: any) {
      console.warn(`  [P5] Failed to merge "${duplicate.name}": ${err.message}`);
    }
  }
  console.log(`  Pass 5: Merged ${merged} middle-initial variants`);
  return merged;
}

// --- Pass 6: Targeted OCR/Nickname Merges (Hardcoded) ---
const OCR_NICKNAME_MERGES: { canonical: string; variants: string[] }[] = [
  { canonical: "Glenn Dubin", variants: ["Glen Dubin"] },
  { canonical: "Jussie Smollett", variants: ["Jessie Smollett"] },
  { canonical: "Steven Mnuchin", variants: ["Steve Mnuchin"] },
  { canonical: "Bobbi Sternheim", variants: ["Bobbi Stemheim", "Bobbi C. Sternheim"] },
  { canonical: "Christian Everdell", variants: ["Christian R. Everdell", "Chrstian Everdell"] },
  { canonical: "Bradley Edwards", variants: ["Bradley James Edwards", "Brad Edwards"] },
  { canonical: "Eva Andersson-Dubin", variants: ["Eva Dubin", "Eva Andersson Dubin"] },
  { canonical: "Peter Skinner", variants: ["Pete Skinner"] },
  { canonical: "Saimir Alimehmeti", variants: ["Sajmir Alimehmeti"] },
  { canonical: "Sigrid McCawley", variants: ["Sigrid S. McCawley"] },
  { canonical: "Paul Cassell", variants: ["Paul G. Cassell"] },
  { canonical: "David Boies", variants: ["David Boles", "David Boie"] },
  { canonical: "Lesley Groff", variants: ["Leslie Groff"] },
  { canonical: "Sarah Kellen", variants: ["Sarah Kellen Vickers", "Sarah K. Vickers"] },
  { canonical: "Alfredo Rodriguez", variants: ["Alfred Rodriguez"] },
  { canonical: "Adriana Ross", variants: ["Adriana Mucinska", "Adriana Mucinska Ross"] },
  { canonical: "Haley Robson", variants: ["Hailey Robson"] },
  { canonical: "Courtney Wild", variants: ["Courtney Wilde"] },
  { canonical: "Michael Reiter", variants: ["Michael Retter", "Chief Reiter"] },
  { canonical: "Joseph Recarey", variants: ["Joe Recarey", "Det. Recarey"] },
];

async function pass6OCRNickname(): Promise<number> {
  let total = 0;
  for (const entry of OCR_NICKNAME_MERGES) {
    const [canonicalRow] = await db.select().from(persons)
      .where(sql`LOWER(${persons.name}) = LOWER(${entry.canonical})`)
      .limit(1);
    if (!canonicalRow) continue;

    for (const variant of entry.variants) {
      const [variantRow] = await db.select().from(persons)
        .where(sql`LOWER(${persons.name}) = LOWER(${variant})`)
        .limit(1);
      if (variantRow && variantRow.id !== canonicalRow.id) {
        await mergePersonGroup(canonicalRow, [variantRow.id], [variantRow.name]);
        total++;
        console.log(`  [P6] Merged "${variantRow.name}" → "${canonicalRow.name}"`);
      }
    }
  }
  console.log(`  Pass 6: Merged ${total} OCR/nickname variants`);
  return total;
}

// --- Coordinator ---
export async function deduplicatePersonsInDB(): Promise<void> {
  console.log("Deduplicating persons in database (6-pass conservative approach)...");
  const protectedNames = loadProtectedNames();

  const [beforeCount] = await db.select({ count: sql<number>`count(*)::int` }).from(persons);
  console.log(`  Starting person count: ${beforeCount?.count}`);

  const stats = {
    pass0: await pass0JunkRemoval(protectedNames),
    pass1: await pass1ExactNormalized(protectedNames),
    pass2: await pass2SingleWordEvidence(protectedNames),
    pass3: await pass3DeleteSingleWord(protectedNames),
    pass4: await pass4KeyFigures(),
    pass5: await pass5MiddleInitial(protectedNames),
    pass6: await pass6OCRNickname(),
  };

  // Final cleanup: delete self-loop connections
  await db.execute(sql`DELETE FROM connections WHERE person_id_1 = person_id_2`);

  const [afterCount] = await db.select({ count: sql<number>`count(*)::int` }).from(persons);

  console.log("\n  === Deduplication Summary ===");
  console.log(`  Pass 0 (junk removal):      ${stats.pass0} removed`);
  console.log(`  Pass 1 (exact normalized):   ${stats.pass1} merged`);
  console.log(`  Pass 2 (single→multi evidence): ${stats.pass2} merged`);
  console.log(`  Pass 3 (delete single-word): ${stats.pass3} deleted`);
  console.log(`  Pass 4 (key figure variants):${stats.pass4} processed`);
  console.log(`  Pass 5 (middle-initial):     ${stats.pass5} merged`);
  console.log(`  Pass 6 (OCR/nickname):       ${stats.pass6} merged`);
  console.log(`  Person count: ${beforeCount?.count} → ${afterCount?.count}`);
}

/**
 * Deduplicate connections: keep ONE connection per undirected person pair.
 * Keeps the record with the longest description, highest strength, lowest id as tiebreaker.
 */
export async function deduplicateConnections(): Promise<void> {
  console.log("Deduplicating connections...");

  const [beforeCount] = await db.select({ count: sql<number>`count(*)::int` }).from(connections);
  console.log(`  Connections before: ${beforeCount?.count}`);

  // Delete all connections that are NOT the best representative per undirected pair
  await db.execute(sql`
    DELETE FROM connections WHERE id NOT IN (
      SELECT DISTINCT ON (LEAST(person_id_1, person_id_2), GREATEST(person_id_1, person_id_2))
        id
      FROM connections
      ORDER BY LEAST(person_id_1, person_id_2), GREATEST(person_id_1, person_id_2),
        COALESCE(LENGTH(description), 0) DESC, strength DESC, id ASC
    )
  `);

  // Also remove any self-loop connections
  await db.execute(sql`DELETE FROM connections WHERE person_id_1 = person_id_2`);

  const [afterCount] = await db.select({ count: sql<number>`count(*)::int` }).from(connections);
  console.log(`  Connections after: ${afterCount?.count}`);
  console.log(`  Removed ${(beforeCount?.count || 0) - (afterCount?.count || 0)} duplicate connections`);
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
    const supportedExtensions = [".pdf", ".mp4", ".avi", ".mov", ".wmv", ".webm", ".jpg", ".jpeg", ".png", ".gif"];
    const files = fs.readdirSync(dsPath).filter(f => supportedExtensions.some(ext => f.toLowerCase().endsWith(ext)));

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

    console.log(`  Processing ${dsName}: ${files.length} files...`);

    let dsLoaded = 0;
    let dsSkipped = 0;

    // --- Batch processing ---
    const BATCH_SIZE = 500;

    // Build all file info upfront
    const fileInfos = files.map(file => {
      const sourceUrl = urlMap.get(file) || `https://www.justice.gov/epstein/files/DataSet%20${dsNum}/${encodeURIComponent(file)}`;
      const efta = file.replace(/\.[^.]+$/, "");
      const ext = path.extname(file).toLowerCase();
      const filePath = path.join(dsPath, file);
      const fileStat = fs.statSync(filePath);
      const fileSizeKB = Math.round(fileStat.size / 1024);
      const docType = [".mp4", ".avi", ".mov", ".wmv", ".webm"].includes(ext)
        ? "video"
        : [".jpg", ".jpeg", ".png", ".gif"].includes(ext)
        ? "photograph"
        : ext === ".pdf"
        ? "government record"
        : inferDocumentType(dsDesc);
      const fileTypeTag = ext === ".pdf" ? "PDF" : ext.replace(".", "").toUpperCase();

      return { file, sourceUrl, efta, ext, filePath, fileSizeKB, docType, fileTypeTag };
    });

    // Process in batches
    for (let i = 0; i < fileInfos.length; i += BATCH_SIZE) {
      const batch = fileInfos.slice(i, i + BATCH_SIZE);
      const batchUrls = batch.map(f => f.sourceUrl);

      // Batch SELECT — one query for up to 500 files
      const existingDocs = await db
        .select({ id: documents.id, sourceUrl: documents.sourceUrl, localPath: documents.localPath })
        .from(documents)
        .where(inArray(documents.sourceUrl, batchUrls));

      const existingByUrl = new Map(existingDocs.map(d => [d.sourceUrl, d]));

      // Separate records that need localPath updates vs new inserts
      const needsLocalPathUpdate: { id: number; localPath: string }[] = [];
      const newRecords: typeof batch = [];

      for (const info of batch) {
        const existing = existingByUrl.get(info.sourceUrl);
        if (existing) {
          if (!existing.localPath) {
            needsLocalPathUpdate.push({ id: existing.id, localPath: info.filePath });
          }
          skipped++;
          dsSkipped++;
        } else {
          newRecords.push(info);
        }
      }

      // Batch UPDATE localPaths for records missing it
      for (const update of needsLocalPathUpdate) {
        await db.update(documents)
          .set({ localPath: update.localPath })
          .where(eq(documents.id, update.id));
      }

      // Batch INSERT — chunk to stay within Postgres parameter limits
      if (newRecords.length > 0) {
        const INSERT_CHUNK = 100;
        for (let j = 0; j < newRecords.length; j += INSERT_CHUNK) {
          const chunk = newRecords.slice(j, j + INSERT_CHUNK);
          try {
            await db.insert(documents).values(
              chunk.map(info => ({
                title: `${info.efta} (${dsName})`,
                description: `${dsDesc}. File: ${info.efta}. Size: ${info.fileSizeKB}KB.`,
                documentType: info.docType,
                dataSet: String(dsNum),
                sourceUrl: info.sourceUrl,
                localPath: info.filePath,
                datePublished: "2026-01-30",
                isRedacted: true,
                tags: [`data-set-${dsNum}`, "DOJ disclosure", info.fileTypeTag, info.docType],
              }))
            ).onConflictDoNothing();
            loaded += chunk.length;
            dsLoaded += chunk.length;
          } catch (error: any) {
            // Fallback: insert individually if batch fails
            for (const info of chunk) {
              try {
                await db.insert(documents).values({
                  title: `${info.efta} (${dsName})`,
                  description: `${dsDesc}. File: ${info.efta}. Size: ${info.fileSizeKB}KB.`,
                  documentType: info.docType,
                  dataSet: String(dsNum),
                  sourceUrl: info.sourceUrl,
                  localPath: info.filePath,
                  datePublished: "2026-01-30",
                  isRedacted: true,
                  tags: [`data-set-${dsNum}`, "DOJ disclosure", info.fileTypeTag, info.docType],
                });
                loaded++;
                dsLoaded++;
              } catch (e: any) {
                if (!e.message.includes("duplicate")) {
                  console.warn(`    Error loading ${info.file}: ${e.message}`);
                }
              }
            }
          }
        }
      }

      // Progress logging every 10 batches
      if (i % (BATCH_SIZE * 10) === 0 && i > 0) {
        console.log(`    Progress: ${i}/${fileInfos.length} files processed...`);
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

  // --- Cache: load previously classified connections from disk ---
  const cacheFile = path.join(__dirname, "../../data/connection-classifications.json");
  type CachedClassification = { connectionType: string; description: string; strength: number };
  const cache = new Map<string, CachedClassification>();

  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Record<string, CachedClassification>;
      for (const [key, val] of Object.entries(cached)) {
        cache.set(key, val);
      }
      console.log(`  Loaded ${cache.size} cached classifications from disk`);
    } catch {
      console.warn("  Could not parse cache file, starting fresh");
    }
  }

  function cacheKey(name1: string, name2: string): string {
    return [name1, name2].sort().join(" <-> ");
  }

  // Separate into cached and uncached
  const uncached: typeof connectionTriples = [];
  for (const triple of connectionTriples) {
    const key = cacheKey(triple.person1Name, triple.person2Name);
    const hit = cache.get(key);
    if (hit) {
      try {
        await db.insert(connections).values({
          personId1: triple.person1Id,
          personId2: triple.person2Id,
          connectionType: hit.connectionType,
          description: hit.description.substring(0, 500),
          strength: hit.strength,
        });
        connectionsCreated++;
      } catch { /* skip duplicates */ }
    } else {
      uncached.push(triple);
    }
  }

  if (uncached.length < connectionTriples.length) {
    console.log(`  Used cache for ${connectionTriples.length - uncached.length} connections, ${uncached.length} need classification`);
  }

  // --- Classify uncached connections via AI or regex ---
  const deepseek = getDeepSeek();
  if (deepseek && uncached.length > 0) {
    console.log("  Using AI to classify connection types...");
    const BATCH_SIZE = 25;

    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
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

            // Save to cache
            cache.set(cacheKey(triple.person1Name, triple.person2Name), {
              connectionType: cls.connectionType,
              description: cls.description.substring(0, 500),
              strength: cls.strength,
            });

            try {
              await db.insert(connections).values({
                personId1: triple.person1Id,
                personId2: triple.person2Id,
                connectionType: cls.connectionType,
                description: cls.description.substring(0, 500),
                strength: cls.strength,
              });
              connectionsCreated++;
            } catch { /* skip */ }
          }
        }
      } catch (error: any) {
        console.warn(`  AI classification failed for batch at index ${i}, falling back to regex: ${error.message}`);
        for (const triple of batch) {
          const { connectionType, strength } = inferRelationshipType(triple.context);
          cache.set(cacheKey(triple.person1Name, triple.person2Name), {
            connectionType, description: triple.context.substring(0, 500), strength,
          });
          try {
            await db.insert(connections).values({
              personId1: triple.person1Id, personId2: triple.person2Id,
              connectionType, description: triple.context.substring(0, 500), strength,
            });
            connectionsCreated++;
          } catch { /* skip */ }
        }
      }

      // Save cache after each batch (crash-safe)
      const cacheObj: Record<string, CachedClassification> = {};
      for (const [k, v] of cache) cacheObj[k] = v;
      fs.writeFileSync(cacheFile, JSON.stringify(cacheObj, null, 2));

      if ((i / BATCH_SIZE) % 10 === 0) {
        console.log(`    Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uncached.length / BATCH_SIZE)} (${connectionsCreated} created, ${cache.size} cached)`);
      }

      if (i + BATCH_SIZE < uncached.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } else if (uncached.length > 0) {
    if (!deepseek) console.log("  No DEEPSEEK_API_KEY set, using regex classification...");
    for (const triple of uncached) {
      const { connectionType, strength } = inferRelationshipType(triple.context);
      cache.set(cacheKey(triple.person1Name, triple.person2Name), {
        connectionType, description: triple.context.substring(0, 500), strength,
      });
      try {
        await db.insert(connections).values({
          personId1: triple.person1Id, personId2: triple.person2Id,
          connectionType, description: triple.context.substring(0, 500), strength,
        });
        connectionsCreated++;
      } catch { /* skip */ }
    }
  }

  // Final cache save
  const cacheObj: Record<string, CachedClassification> = {};
  for (const [k, v] of cache) cacheObj[k] = v;
  fs.writeFileSync(cacheFile, JSON.stringify(cacheObj, null, 2));
  console.log(`  Saved ${cache.size} classifications to cache`);

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
    } else if (command === "dedup-connections") {
      await deduplicateConnections();
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
      console.log("  dedup-connections     - Deduplicate connections (keep best per pair)");
      console.log("  classify-media [dir]  - Classify documents by media type (--reclassify to redo all)");
    }

    process.exit(0);
  })().catch(console.error);
}
