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
    const sort = req.query.sort as string | undefined;
    // Always paginate for v1
    const result = await storage.getPersonsPaginated(page, limit);
    res.json(envelope(result.data, { total: result.total, page: result.page, totalPages: result.totalPages, limit }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch persons");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");

    const person = await storage.getPersonWithDetails(id);
    if (!person) return sendError(res, 404, "NOT_FOUND", "Person not found");

    // Strip internal fields from embedded documents
    if (person.documents) {
      person.documents = person.documents.map((d: any) => stripInternalFields(d));
    }

    res.json(envelope(person));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch person");
  }
});

router.get("/:id/connections", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");

    const person = await storage.getPersonWithDetails(id);
    if (!person) return sendError(res, 404, "NOT_FOUND", "Person not found");

    res.json(envelope(person.connections || []));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch person connections");
  }
});

router.get("/:id/documents", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");
    const { page, limit } = parsePageParams(req.query as any);

    const person = await storage.getPersonWithDetails(id);
    if (!person) return sendError(res, 404, "NOT_FOUND", "Person not found");

    const docs = (person.documents || []).map((d: any) => stripInternalFields(d));
    const total = docs.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginated = docs.slice(offset, offset + limit);

    res.json(envelope(paginated, { total, page, totalPages, limit }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch person documents");
  }
});

router.get("/:id/timeline", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");

    const person = await storage.getPersonWithDetails(id);
    if (!person) return sendError(res, 404, "NOT_FOUND", "Person not found");

    res.json(envelope(person.timelineEvents || []));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch person timeline");
  }
});

export default router;
