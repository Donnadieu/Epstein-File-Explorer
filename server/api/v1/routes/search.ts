import { Router } from "express";
import { storage } from "../../../storage";
import { envelope, sendError, parsePageParams } from "../types";
import { isTypesenseConfigured, typesenseSearchPages } from "../../../typesense";
import { getPublicUrl } from "../../../r2";

const router = Router();

function stripInternalFields(doc: any) {
  const { localPath, r2Key, fileHash, ...rest } = doc;
  return { ...rest, publicUrl: r2Key ? getPublicUrl(r2Key) : null };
}

router.get("/", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) {
      return sendError(res, 400, "BAD_REQUEST", "Query must be at least 2 characters");
    }

    let results: any;
    if (isTypesenseConfigured()) {
      try {
        results = await storage.searchWithTypesense(q);
      } catch {
        results = await storage.search(q);
      }
    } else {
      results = await storage.search(q);
    }

    // Strip internal fields from documents
    if (results.documents) {
      results.documents = results.documents.map(stripInternalFields);
    }

    res.json(envelope(results));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Search failed");
  }
});

router.get("/pages", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) {
      return res.json(envelope([], { total: 0, page: 1, totalPages: 0, limit: 50 }));
    }

    const { page, limit } = parsePageParams(req.query as any);
    const documentType = req.query.documentType as string | undefined;
    const dataSet = req.query.dataSet as string | undefined;

    let result: any;
    if (isTypesenseConfigured()) {
      try {
        result = await typesenseSearchPages(q, page, limit, { documentType, dataSet });
      } catch {
        result = await storage.searchPages(q, page, limit);
      }
    } else {
      result = await storage.searchPages(q, page, limit);
    }

    res.json(envelope(result.results, { total: result.total, page: result.page, totalPages: result.totalPages, limit }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Page search failed");
  }
});

export default router;
