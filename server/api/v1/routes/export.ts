import { Router } from "express";
import { storage } from "../../../storage";
import { sendError } from "../types";
import { obsidianExportHandler } from "./obsidian-export";

const router = Router();

// Obsidian vault export (zip)
router.get("/obsidian", obsidianExportHandler);

function toCsvRow(headers: string[], obj: Record<string, unknown>): string {
  return headers.map(h => {
    const val = obj[h];
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(",");
}

function sendCsv(res: any, filename: string, headers: string[], rows: Record<string, unknown>[]) {
  const csvLines = [headers.join(","), ...rows.map(r => toCsvRow(headers, r))];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(csvLines.join("\n"));
}

function sendJsonDownload(res: any, filename: string, data: any) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.json(data);
}

// Export persons
router.get("/persons", async (req, res) => {
  try {
    const format = (req.query.format as string) || "json";
    const persons = await storage.getPersons();

    if (format === "csv") {
      const headers = ["id", "name", "role", "description", "status", "nationality", "occupation", "category", "documentCount", "connectionCount"];
      return sendCsv(res, "persons.csv", headers, persons as any);
    }
    sendJsonDownload(res, "persons.json", persons);
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to export persons");
  }
});

// Export documents
router.get("/documents", async (req, res) => {
  try {
    const format = (req.query.format as string) || "json";
    const documents = await storage.getDocuments();

    if (format === "csv") {
      const headers = ["id", "title", "documentType", "dataSet", "datePublished", "dateOriginal", "pageCount", "isRedacted", "processingStatus", "aiAnalysisStatus"];
      return sendCsv(res, "documents.csv", headers, documents as any);
    }
    sendJsonDownload(res, "documents.json", documents);
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to export documents");
  }
});

// Export connections (NEW)
router.get("/connections", async (req, res) => {
  try {
    const format = (req.query.format as string) || "json";
    // Use network data for enriched connections with person names
    const networkData = await storage.getNetworkData();
    const conns = networkData.connections;

    if (format === "csv") {
      const headers = ["id", "personId1", "person1Name", "personId2", "person2Name", "connectionType", "description", "strength"];
      return sendCsv(res, "connections.csv", headers, conns as any);
    }
    sendJsonDownload(res, "connections.json", conns);
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to export connections");
  }
});

// Export timeline (NEW)
router.get("/timeline", async (req, res) => {
  try {
    const format = (req.query.format as string) || "json";
    const events = await storage.getTimelineEvents();

    if (format === "csv") {
      const headers = ["id", "date", "title", "description", "category", "significance"];
      return sendCsv(res, "timeline.csv", headers, events as any);
    }
    sendJsonDownload(res, "timeline.json", events);
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to export timeline");
  }
});

// Export graph (NEW) — JSON (D3 format) or GraphML
router.get("/graph", async (req, res) => {
  try {
    const format = (req.query.format as string) || "json";
    const networkData = await storage.getNetworkData();

    if (format === "graphml") {
      const xml = toGraphML(networkData);
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", "attachment; filename=epstein-network.graphml");
      return res.send(xml);
    }

    // D3-compatible JSON format
    const graph = {
      nodes: networkData.persons.map((p: any) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        category: p.category,
        documentCount: p.documentCount,
        connectionCount: p.connectionCount,
      })),
      links: networkData.connections.map((c: any) => ({
        source: c.personId1,
        target: c.personId2,
        type: c.connectionType,
        strength: c.strength,
        description: c.description,
      })),
      timelineYearRange: networkData.timelineYearRange,
    };

    sendJsonDownload(res, "epstein-network.json", graph);
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to export graph");
  }
});

// Export search results
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q as string) || "";
    const format = (req.query.format as string) || "json";

    if (q.length < 2) {
      return sendError(res, 400, "BAD_REQUEST", "Query must be at least 2 characters");
    }

    const results = await storage.search(q);

    if (format === "csv") {
      const headers = ["type", "id", "name_or_title", "description"];
      const rows: Record<string, unknown>[] = [];
      for (const p of results.persons) rows.push({ type: "person", id: p.id, name_or_title: p.name, description: p.description });
      for (const d of results.documents) rows.push({ type: "document", id: d.id, name_or_title: d.title, description: d.description });
      for (const e of results.events) rows.push({ type: "event", id: e.id, name_or_title: e.title, description: e.description });
      return sendCsv(res, "search-results.csv", headers, rows);
    }

    sendJsonDownload(res, "search-results.json", results);
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to export search results");
  }
});

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toGraphML(networkData: any): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphstruct.org/graphml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphstruct.org/graphml http://graphml.graphstruct.org/graphml/1.0/graphml.xsd">',
    '  <key id="name" for="node" attr.name="name" attr.type="string"/>',
    '  <key id="role" for="node" attr.name="role" attr.type="string"/>',
    '  <key id="category" for="node" attr.name="category" attr.type="string"/>',
    '  <key id="documentCount" for="node" attr.name="documentCount" attr.type="int"/>',
    '  <key id="connectionCount" for="node" attr.name="connectionCount" attr.type="int"/>',
    '  <key id="connectionType" for="edge" attr.name="connectionType" attr.type="string"/>',
    '  <key id="strength" for="edge" attr.name="strength" attr.type="int"/>',
    '  <key id="description" for="edge" attr.name="description" attr.type="string"/>',
    '  <graph id="epstein-network" edgedefault="undirected">',
  ];

  for (const p of networkData.persons) {
    lines.push(`    <node id="n${p.id}">`);
    lines.push(`      <data key="name">${escapeXml(p.name || "")}</data>`);
    lines.push(`      <data key="role">${escapeXml(p.role || "")}</data>`);
    lines.push(`      <data key="category">${escapeXml(p.category || "")}</data>`);
    lines.push(`      <data key="documentCount">${p.documentCount || 0}</data>`);
    lines.push(`      <data key="connectionCount">${p.connectionCount || 0}</data>`);
    lines.push(`    </node>`);
  }

  for (const c of networkData.connections) {
    lines.push(`    <edge source="n${c.personId1}" target="n${c.personId2}">`);
    lines.push(`      <data key="connectionType">${escapeXml(c.connectionType || "")}</data>`);
    lines.push(`      <data key="strength">${c.strength || 0}</data>`);
    lines.push(`      <data key="description">${escapeXml(c.description || "")}</data>`);
    lines.push(`    </edge>`);
  }

  lines.push("  </graph>");
  lines.push("</graphml>");
  return lines.join("\n");
}

export default router;
