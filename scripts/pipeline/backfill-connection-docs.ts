import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { connections, personDocuments } from "../../shared/schema";

/**
 * Backfill documentIds on existing connections by computing shared documents
 * between the two connected persons via the person_documents join table.
 */
export async function backfillConnectionDocs(): Promise<number> {
  console.log("Backfilling connection documentIds from person_documents...");

  // Load person→documentIds lookup
  const allLinks = await db
    .select({ personId: personDocuments.personId, documentId: personDocuments.documentId })
    .from(personDocuments);

  const personDocIds = new Map<number, Set<number>>();
  for (const l of allLinks) {
    if (!personDocIds.has(l.personId)) personDocIds.set(l.personId, new Set());
    personDocIds.get(l.personId)!.add(l.documentId);
  }
  console.log(`  Loaded ${allLinks.length} person↔doc links for ${personDocIds.size} persons`);

  function sharedDocumentIds(p1: number, p2: number): number[] {
    const d1 = personDocIds.get(p1);
    const d2 = personDocIds.get(p2);
    if (!d1 || !d2) return [];
    return [...d1].filter(id => d2.has(id));
  }

  // Load connections with null/empty documentIds
  const conns = await db.select({
    id: connections.id,
    personId1: connections.personId1,
    personId2: connections.personId2,
    documentIds: connections.documentIds,
  }).from(connections)
    .where(sql`document_ids IS NULL OR array_length(document_ids, 1) IS NULL`);

  console.log(`  Found ${conns.length} connections to backfill`);

  let updated = 0;
  const BATCH_SIZE = 500;

  for (let i = 0; i < conns.length; i += BATCH_SIZE) {
    const batch = conns.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(c => {
      const docIds = sharedDocumentIds(c.personId1, c.personId2);
      if (docIds.length === 0) return Promise.resolve();
      updated++;
      return db.update(connections)
        .set({ documentIds: docIds })
        .where(eq(connections.id, c.id));
    }));

    if ((i / BATCH_SIZE) % 10 === 0 || i + BATCH_SIZE >= conns.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, conns.length)}/${conns.length} (${updated} updated)`);
    }
  }

  console.log(`  Backfill complete: ${updated} connections updated with documentIds`);
  return updated;
}
