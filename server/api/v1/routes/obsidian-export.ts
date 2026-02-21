import type { Request, Response } from "express";
import archiver from "archiver";
import { storage } from "../../../storage";

/** Sanitize a string for use as a filename */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Build YAML frontmatter from key-value pairs */
function frontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, val] of Object.entries(fields)) {
    if (val === null || val === undefined) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`);
    } else if (typeof val === "string" && (val.includes(":") || val.includes('"') || val.includes("\n"))) {
      lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function personToMarkdown(person: any, connectionsByPerson: Map<number, any[]>, docsByPerson: Map<number, string[]>): string {
  const fm = frontmatter({
    id: person.id,
    name: person.name,
    role: person.role,
    category: person.category,
    status: person.status,
    nationality: person.nationality,
    occupation: person.occupation,
    documentCount: person.documentCount,
    connectionCount: person.connectionCount,
    aliases: person.aliases,
  });

  const lines = [fm, "", `# ${person.name}`, ""];

  const meta: string[] = [];
  if (person.role) meta.push(`**Role:** ${person.role}`);
  if (person.category) meta.push(`**Category:** ${person.category}`);
  if (person.status) meta.push(`**Status:** ${person.status}`);
  if (meta.length) lines.push(meta.join(" | "), "");

  if (person.description) {
    lines.push("## Description", "", person.description, "");
  }

  const conns = connectionsByPerson.get(person.id);
  if (conns && conns.length > 0) {
    lines.push("## Connections", "");
    for (const c of conns) {
      const otherName = c.personId1 === person.id ? c.person2Name : c.person1Name;
      lines.push(`- [[${otherName}]] (${c.connectionType}, strength: ${c.strength})`);
    }
    lines.push("");
  }

  const docs = docsByPerson.get(person.id);
  if (docs && docs.length > 0) {
    lines.push("## Related Documents", "");
    for (const title of docs.slice(0, 50)) {
      lines.push(`- [[${title}]]`);
    }
    if (docs.length > 50) lines.push(`- _...and ${docs.length - 50} more_`);
    lines.push("");
  }

  return lines.join("\n");
}

function documentToMarkdown(doc: any, personNames: string[]): string {
  const fm = frontmatter({
    id: doc.id,
    title: doc.title,
    documentType: doc.documentType,
    dataSet: doc.dataSet,
    datePublished: doc.datePublished,
    dateOriginal: doc.dateOriginal,
    pageCount: doc.pageCount,
    isRedacted: doc.isRedacted,
    tags: doc.tags,
  });

  const lines = [fm, "", `# ${doc.title}`, ""];

  const meta: string[] = [];
  if (doc.documentType) meta.push(`**Type:** ${doc.documentType}`);
  if (doc.dataSet) meta.push(`**Data Set:** ${doc.dataSet}`);
  if (doc.pageCount) meta.push(`**Pages:** ${doc.pageCount}`);
  if (meta.length) lines.push(meta.join(" | "), "");

  if (doc.description) {
    lines.push("## Description", "", doc.description, "");
  }

  if (doc.keyExcerpt) {
    lines.push("## Key Excerpt", "", `> ${doc.keyExcerpt}`, "");
  }

  if (personNames.length > 0) {
    lines.push("## Mentioned Persons", "");
    for (const name of personNames) {
      lines.push(`- [[${name}]]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function eventToMarkdown(event: any): string {
  const fm = frontmatter({
    id: event.id,
    date: event.date,
    category: event.category,
    significance: event.significance,
  });

  const title = `${event.date} — ${event.title}`;
  const lines = [fm, "", `# ${title}`, ""];

  const meta: string[] = [];
  if (event.category) meta.push(`**Category:** ${event.category}`);
  if (event.significance) meta.push(`**Significance:** ${event.significance}`);
  if (meta.length) lines.push(meta.join(" | "), "");

  if (event.description) {
    lines.push(event.description, "");
  }

  if (event.persons?.length > 0) {
    lines.push("## Related Persons", "");
    for (const p of event.persons) {
      lines.push(`- [[${p.name}]]`);
    }
    lines.push("");
  }

  if (event.documents?.length > 0) {
    lines.push("## Related Documents", "");
    for (const d of event.documents) {
      lines.push(`- [[${d.title}]]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function connectionToMarkdown(conn: any): string {
  const fm = frontmatter({
    person1: conn.person1Name,
    person2: conn.person2Name,
    type: conn.connectionType,
    strength: conn.strength,
  });

  const title = `${conn.person1Name} ↔ ${conn.person2Name}`;
  const lines = [fm, "", `# ${title}`, ""];

  const meta: string[] = [];
  if (conn.connectionType) meta.push(`**Type:** ${conn.connectionType}`);
  if (conn.strength) meta.push(`**Strength:** ${conn.strength}`);
  if (meta.length) lines.push(meta.join(" | "), "");

  if (conn.description) {
    lines.push(conn.description, "");
  }

  lines.push("## Related Persons", "");
  lines.push(`- [[${conn.person1Name}]]`);
  lines.push(`- [[${conn.person2Name}]]`);
  lines.push("");

  return lines.join("\n");
}

const DOC_BATCH_SIZE = 5000;

export async function obsidianExportHandler(_req: Request, res: Response): Promise<void> {
  try {
    // Fetch cached data first (persons, events, network are all cached & small)
    const [persons, events, networkData] = await Promise.all([
      storage.getPersons(),
      storage.getTimelineEvents(),
      storage.getNetworkData(),
    ]);

    const connections = networkData.connections;

    // Build lookup maps for cross-referencing
    const connectionsByPerson = new Map<number, any[]>();
    for (const c of connections) {
      if (!connectionsByPerson.has(c.personId1)) connectionsByPerson.set(c.personId1, []);
      if (!connectionsByPerson.has(c.personId2)) connectionsByPerson.set(c.personId2, []);
      connectionsByPerson.get(c.personId1)!.push(c);
      connectionsByPerson.get(c.personId2)!.push(c);
    }

    // Pre-build docId → person names from timeline events (avoids O(docs*events) loop)
    const docPersonNames = new Map<number, string[]>();
    for (const event of events) {
      if (!event.documentIds?.length || !event.persons?.length) continue;
      for (const docId of event.documentIds) {
        if (!docPersonNames.has(docId)) docPersonNames.set(docId, []);
        const names = docPersonNames.get(docId)!;
        for (const p of event.persons) {
          if (!names.includes(p.name)) names.push(p.name);
        }
      }
    }

    const docsByPerson = new Map<number, string[]>();

    // Set up streaming zip
    const archive = archiver("zip", { zlib: { level: 1 } });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=epstein-vault.zip");

    archive.pipe(res);

    // Add persons (cached, ~8k)
    for (const person of persons) {
      const md = personToMarkdown(person, connectionsByPerson, docsByPerson);
      archive.append(md, { name: `Persons/${sanitizeFilename(person.name)}.md` });
    }

    // Add documents in batches to avoid loading 1.3M rows into memory
    let docPage = 1;
    let hasMore = true;
    while (hasMore) {
      const batch = await storage.getDocumentsPaginated(docPage, DOC_BATCH_SIZE);
      for (const doc of batch.data) {
        const mentioned = docPersonNames.get(doc.id) || [];
        const md = documentToMarkdown(doc, mentioned);
        archive.append(md, { name: `Documents/${sanitizeFilename(doc.title)}.md` });
      }
      hasMore = docPage < batch.totalPages;
      docPage++;
    }

    // Add timeline events (cached, ~17k)
    for (const event of events) {
      const dateStr = event.date || "unknown";
      const md = eventToMarkdown(event);
      archive.append(md, { name: `Timeline/${sanitizeFilename(`${dateStr} - ${event.title}`)}.md` });
    }

    // Add connections (from cached network data, ~13k)
    for (const conn of connections) {
      const md = connectionToMarkdown(conn);
      archive.append(md, { name: `Connections/${sanitizeFilename(`${conn.person1Name} - ${conn.person2Name}`)}.md` });
    }

    await archive.finalize();
  } catch (error) {
    console.error("Obsidian export error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to generate Obsidian vault" },
        meta: { apiVersion: "v1", timestamp: new Date().toISOString() },
      });
    }
  }
}
