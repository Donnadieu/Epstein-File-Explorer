import { Router } from "express";
import { storage } from "../../../storage";
import { envelope, sendError, parsePageParams, parseId } from "../types";
import { getPublicUrl } from "../../../r2";

const router = Router();

function stripInternalFields(doc: any) {
  const { localPath, r2Key, fileHash, ...rest } = doc;
  return { ...rest, publicUrl: r2Key ? getPublicUrl(r2Key) : null };
}

router.get("/", async (req, res) => {
  try {
    const { page, limit } = parsePageParams(req.query as any);
    const search = req.query.search as string | undefined;
    const type = req.query.type as string | undefined;
    const dataSet = req.query.dataSet as string | undefined;
    const redacted = req.query.redacted as string | undefined;
    const mediaType = req.query.mediaType as string | undefined;
    const sort = req.query.sort as string | undefined;

    const result = await storage.getDocumentsFiltered({
      page, limit, search, type, dataSet, redacted, mediaType, sort,
    });

    const data = result.data.map(stripInternalFields);
    res.json(envelope(data, { total: result.total, page: result.page, totalPages: result.totalPages, limit }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch documents");
  }
});

router.get("/filters", async (_req, res) => {
  try {
    const filters = await storage.getDocumentFilters();
    res.json(envelope(filters));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch document filters");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");

    const doc = await storage.getDocumentWithDetails(id);
    if (!doc) return sendError(res, 404, "NOT_FOUND", "Document not found");

    res.json(envelope(stripInternalFields(doc)));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch document");
  }
});

router.get("/:id/persons", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");

    const doc = await storage.getDocumentWithDetails(id);
    if (!doc) return sendError(res, 404, "NOT_FOUND", "Document not found");

    res.json(envelope(doc.persons || []));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch document persons");
  }
});

export default router;
