import { db } from "./db";
import { sql, eq, and, asc } from "drizzle-orm";
import {
  pipelineJobs,
  budgetTracking,
  documents,
  documentPages,
  persons,
  connections,
  personDocuments,
  timelineEvents,
} from "@shared/schema";
import { analyzeDocument } from "./chat/analyze";
import { log } from "./index";

const WORKER_INTERVAL_MS = 60_000;
const DAILY_BUDGET_CENTS = parseInt(process.env.BG_ANALYSIS_BUDGET_CENTS || "100", 10);
const MIN_TEXT_LENGTH = 200;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

function isJunkName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length <= 2) return true;
  if (trimmed.length > 60) return true;
  if (/[!;&$%^]/.test(trimmed)) return true;
  return false;
}

function inferStatus(category: string, role: string): string {
  const lower = `${category} ${role}`.toLowerCase();
  if (lower.includes("victim")) return "victim";
  if (lower.includes("convicted") || lower.includes("defendant")) return "convicted";
  return "named";
}

async function getTodaySpend(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(cost_cents), 0)::int` })
    .from(budgetTracking)
    .where(eq(budgetTracking.date, today));
  return row?.total ?? 0;
}

async function processOneJob(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    // Check daily budget
    const spent = await getTodaySpend();
    if (spent >= DAILY_BUDGET_CENTS) return;

    // Pick the oldest pending job
    const [job] = await db
      .select()
      .from(pipelineJobs)
      .where(
        and(
          eq(pipelineJobs.jobType, "chat-triggered-analysis"),
          eq(pipelineJobs.status, "pending"),
        ),
      )
      .orderBy(asc(pipelineJobs.createdAt))
      .limit(1);

    if (!job) return;

    const documentId = job.documentId;
    if (!documentId) {
      await db.update(pipelineJobs).set({ status: "failed", errorMessage: "No document ID" }).where(eq(pipelineJobs.id, job.id));
      return;
    }

    // Mark as running
    await db.update(pipelineJobs).set({
      status: "running",
      startedAt: new Date(),
      attempts: job.attempts + 1,
    }).where(eq(pipelineJobs.id, job.id));

    // Get document info
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) {
      await db.update(pipelineJobs).set({ status: "failed", errorMessage: "Document not found" }).where(eq(pipelineJobs.id, job.id));
      return;
    }

    // Read all pages for this document
    const pages = await db
      .select({ content: documentPages.content, pageNumber: documentPages.pageNumber })
      .from(documentPages)
      .where(eq(documentPages.documentId, documentId))
      .orderBy(asc(documentPages.pageNumber));

    const fullText = pages.map((p) => `Page ${p.pageNumber}\n${p.content}`).join("\n\n");

    if (fullText.length < MIN_TEXT_LENGTH) {
      await db.update(pipelineJobs).set({ status: "completed", completedAt: new Date(), errorMessage: "Text too short" }).where(eq(pipelineJobs.id, job.id));
      await db.update(documents).set({ aiAnalysisStatus: "skipped" }).where(eq(documents.id, documentId));
      return;
    }

    log(`Background analysis: processing document #${documentId} "${doc.title}"`, "bg-worker");

    const result = await analyzeDocument(fullText, doc.title);

    // --- Insert persons ---
    for (const mention of result.persons) {
      if (isJunkName(mention.name)) continue;

      const existing = await db
        .select()
        .from(persons)
        .where(sql`LOWER(${persons.name}) = LOWER(${mention.name})`)
        .limit(1);

      const newDesc = (mention.context || "").substring(0, 500);
      const status = inferStatus(mention.category, mention.role);

      if (existing.length === 0) {
        try {
          const [inserted] = await db.insert(persons).values({
            name: mention.name,
            category: mention.category,
            role: mention.role,
            description: newDesc,
            status,
            documentCount: 0,
            connectionCount: 0,
          }).returning({ id: persons.id });

          // Link person to document
          if (inserted) {
            await db.insert(personDocuments).values({
              personId: inserted.id,
              documentId,
              context: newDesc,
            }).onConflictDoNothing();
          }
        } catch { /* skip duplicates */ }
      } else {
        const ex = existing[0];
        const updates: Record<string, any> = {};
        if (mention.category && (!ex.category || ex.category === "unknown")) updates.category = mention.category;
        if (mention.role && (!ex.role || ex.role === "unknown")) updates.role = mention.role;
        if (newDesc && newDesc.length > (ex.description?.length || 0)) updates.description = newDesc;

        if (Object.keys(updates).length > 0) {
          await db.update(persons).set(updates).where(eq(persons.id, ex.id));
        }

        // Link person to document
        await db.insert(personDocuments).values({
          personId: ex.id,
          documentId,
          context: newDesc,
        }).onConflictDoNothing();
      }
    }

    // --- Insert connections ---
    for (const conn of result.connections) {
      const [person1] = await db.select().from(persons).where(sql`LOWER(${persons.name}) = LOWER(${conn.person1})`).limit(1);
      const [person2] = await db.select().from(persons).where(sql`LOWER(${persons.name}) = LOWER(${conn.person2})`).limit(1);

      if (person1 && person2) {
        const p1 = Math.min(person1.id, person2.id);
        const p2 = Math.max(person1.id, person2.id);
        const existing = await db.select({ id: connections.id }).from(connections)
          .where(sql`${connections.personId1} = ${p1} AND ${connections.personId2} = ${p2}`)
          .limit(1);

        if (existing.length === 0) {
          try {
            await db.insert(connections).values({
              personId1: p1,
              personId2: p2,
              connectionType: conn.relationshipType,
              description: (conn.description || "").substring(0, 500),
              strength: conn.strength,
            });
          } catch { /* skip */ }
        }
      }
    }

    // --- Insert events ---
    for (const event of result.events) {
      try {
        const personIds: number[] = [];
        const involvedArr = Array.isArray(event.personsInvolved) ? event.personsInvolved : typeof event.personsInvolved === "string" ? (event.personsInvolved as string).split(",").map(s => s.trim()) : [];
        for (const name of involvedArr) {
          const [p] = await db.select().from(persons).where(sql`LOWER(${persons.name}) = LOWER(${name})`).limit(1);
          if (p) personIds.push(p.id);
        }

        const existingEvent = await db.select({ id: timelineEvents.id }).from(timelineEvents)
          .where(sql`${timelineEvents.date} = ${event.date} AND LOWER(${timelineEvents.title}) = LOWER(${event.title})`)
          .limit(1);

        if (existingEvent.length === 0) {
          await db.insert(timelineEvents).values({
            date: event.date,
            title: event.title,
            description: event.description,
            category: event.category,
            significance: event.significance,
            personIds,
            documentIds: [documentId],
          });
        }
      } catch { /* skip */ }
    }

    // --- Mark document as analyzed ---
    await db.update(documents).set({ aiAnalysisStatus: "completed" }).where(eq(documents.id, documentId));

    // --- Track cost ---
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(budgetTracking).values({
      date: today,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costCents: Math.ceil(result.costCents),
      documentId,
      jobType: "chat-triggered-analysis",
    });

    // --- Mark job complete ---
    await db.update(pipelineJobs).set({ status: "completed", completedAt: new Date() }).where(eq(pipelineJobs.id, job.id));

    log(`Background analysis complete: document #${documentId} (${result.persons.length} persons, ${result.connections.length} connections, ${result.events.length} events, cost: ${result.costCents}¢)`, "bg-worker");
  } catch (error: any) {
    log(`Background analysis error: ${error.message}`, "bg-worker");
  } finally {
    processing = false;
  }
}

export function startBackgroundWorker(): void {
  if (!process.env.DEEPSEEK_API_KEY) {
    log("DEEPSEEK_API_KEY not set — background analysis worker disabled", "bg-worker");
    return;
  }

  log(`Background analysis worker started (interval: ${WORKER_INTERVAL_MS / 1000}s, daily budget: ${DAILY_BUDGET_CENTS}¢)`, "bg-worker");
  workerTimer = setInterval(processOneJob, WORKER_INTERVAL_MS);
}

export function stopBackgroundWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    log("Background analysis worker stopped", "bg-worker");
  }
}
