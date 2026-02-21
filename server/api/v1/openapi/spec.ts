export function getOpenAPISpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Epstein File Explorer Public API",
      version: "1.0.0",
      description: "Read-only public API for accessing the Epstein case file database — persons, documents, connections, timeline events, and network graph data.",
    },
    servers: [
      { url: "/api/v1", description: "API v1" },
    ],
    paths: {
      "/health": {
        get: {
          summary: "Service health",
          tags: ["Health & Stats"],
          responses: { "200": { description: "Service status and data counts" } },
        },
      },
      "/stats": {
        get: {
          summary: "Aggregate stats",
          tags: ["Health & Stats"],
          responses: { "200": { description: "Entity counts" } },
        },
      },
      "/persons": {
        get: {
          summary: "List persons",
          tags: ["Persons"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
            { name: "sort", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Paginated person list" } },
        },
      },
      "/persons/{id}": {
        get: {
          summary: "Person detail",
          tags: ["Persons"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": { description: "Full person profile" },
            "404": { description: "Person not found" },
          },
        },
      },
      "/persons/{id}/connections": {
        get: {
          summary: "Person connections",
          tags: ["Persons"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Connections for this person" } },
        },
      },
      "/persons/{id}/documents": {
        get: {
          summary: "Documents mentioning person",
          tags: ["Persons"],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: { "200": { description: "Paginated documents" } },
        },
      },
      "/persons/{id}/timeline": {
        get: {
          summary: "Timeline events for person",
          tags: ["Persons"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Timeline events" } },
        },
      },
      "/documents": {
        get: {
          summary: "List documents",
          tags: ["Documents"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "dataSet", in: "query", schema: { type: "string" } },
            { name: "redacted", in: "query", schema: { type: "string", enum: ["redacted", "unredacted"] } },
            { name: "mediaType", in: "query", schema: { type: "string" } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["popular"] } },
          ],
          responses: { "200": { description: "Paginated, filtered document list" } },
        },
      },
      "/documents/{id}": {
        get: {
          summary: "Document detail",
          tags: ["Documents"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": { description: "Full document detail" },
            "404": { description: "Document not found" },
          },
        },
      },
      "/documents/filters": {
        get: {
          summary: "Available filter values",
          tags: ["Documents"],
          responses: { "200": { description: "Types, data sets, media types" } },
        },
      },
      "/documents/{id}/persons": {
        get: {
          summary: "Persons in document",
          tags: ["Documents"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Persons mentioned in document" } },
        },
      },
      "/connections": {
        get: {
          summary: "List connections",
          tags: ["Connections"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "personId", in: "query", schema: { type: "integer" } },
            { name: "minStrength", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Paginated connections with resolved person names" } },
        },
      },
      "/connections/{id}": {
        get: {
          summary: "Connection detail",
          tags: ["Connections"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": { description: "Single connection" },
            "404": { description: "Connection not found" },
          },
        },
      },
      "/connections/types": {
        get: {
          summary: "Connection types",
          tags: ["Connections"],
          responses: { "200": { description: "Distinct connection types with counts" } },
        },
      },
      "/timeline": {
        get: {
          summary: "Timeline events",
          tags: ["Timeline"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "yearFrom", in: "query", schema: { type: "string" } },
            { name: "yearTo", in: "query", schema: { type: "string" } },
            { name: "significance", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Paginated, filtered timeline events" } },
        },
      },
      "/search": {
        get: {
          summary: "Cross-entity search",
          tags: ["Search"],
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } }],
          responses: { "200": { description: "Persons, documents, and events matching query" } },
        },
      },
      "/search/pages": {
        get: {
          summary: "Full-text page search",
          tags: ["Search"],
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "documentType", in: "query", schema: { type: "string" } },
            { name: "dataSet", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Paginated page-level search results" } },
        },
      },
      "/network": {
        get: {
          summary: "Full network graph",
          tags: ["Network"],
          responses: { "200": { description: "All persons, connections, and year ranges" } },
        },
      },
      "/export/obsidian": {
        get: {
          summary: "Export Obsidian vault",
          tags: ["Export"],
          description: "Downloads a zip file containing a ready-to-use Obsidian vault with markdown files for persons, documents, timeline events, and connections, cross-referenced with [[wikilinks]].",
          responses: {
            "200": {
              description: "Obsidian vault zip file",
              content: { "application/zip": { schema: { type: "string", format: "binary" } } },
            },
          },
        },
      },
      "/export/persons": {
        get: {
          summary: "Export persons",
          tags: ["Export"],
          parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } }],
          responses: { "200": { description: "Bulk person export" } },
        },
      },
      "/export/documents": {
        get: {
          summary: "Export documents",
          tags: ["Export"],
          parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } }],
          responses: { "200": { description: "Bulk document export" } },
        },
      },
      "/export/connections": {
        get: {
          summary: "Export connections",
          tags: ["Export"],
          parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } }],
          responses: { "200": { description: "Bulk connection export with person names" } },
        },
      },
      "/export/timeline": {
        get: {
          summary: "Export timeline",
          tags: ["Export"],
          parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } }],
          responses: { "200": { description: "Bulk timeline export" } },
        },
      },
      "/export/graph": {
        get: {
          summary: "Export network graph",
          tags: ["Export"],
          parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "graphml"], default: "json" } }],
          responses: { "200": { description: "Network graph in D3 JSON or GraphML format" } },
        },
      },
      "/export/search": {
        get: {
          summary: "Export search results",
          tags: ["Export"],
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } },
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } },
          ],
          responses: { "200": { description: "Search results export" } },
        },
      },
      "/ai-analyses": {
        get: {
          summary: "List AI analyses",
          tags: ["AI Analyses"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: { "200": { description: "Paginated AI analysis list" } },
        },
      },
      "/ai-analyses/aggregate": {
        get: {
          summary: "AI analysis stats",
          tags: ["AI Analyses"],
          responses: { "200": { description: "Aggregate analysis statistics" } },
        },
      },
      "/ai-analyses/{fileName}": {
        get: {
          summary: "Single AI analysis",
          tags: ["AI Analyses"],
          parameters: [{ name: "fileName", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Full AI analysis document" },
            "404": { description: "Analysis not found" },
          },
        },
      },
    },
    components: {
      schemas: {
        Envelope: {
          type: "object",
          properties: {
            data: { description: "Response payload" },
            meta: {
              type: "object",
              properties: {
                apiVersion: { type: "string", example: "v1" },
                timestamp: { type: "string", format: "date-time" },
                total: { type: "integer" },
                page: { type: "integer" },
                totalPages: { type: "integer" },
                limit: { type: "integer" },
              },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "NOT_FOUND" },
                message: { type: "string", example: "Resource not found" },
              },
            },
            meta: {
              type: "object",
              properties: {
                apiVersion: { type: "string" },
                timestamp: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
  };
}
