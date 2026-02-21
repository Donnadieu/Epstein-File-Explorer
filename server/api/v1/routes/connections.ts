import { Router } from "express";
import { storage } from "../../../storage";
import { envelope, sendError, parsePageParams, parseId } from "../types";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { page, limit } = parsePageParams(req.query as any);
    const type = req.query.type as string | undefined;
    const personId = req.query.personId ? parseInt(req.query.personId as string) : undefined;
    const minStrength = req.query.minStrength ? parseInt(req.query.minStrength as string) : undefined;

    const result = await storage.getConnectionsPaginated({
      page, limit, type,
      personId: personId && !isNaN(personId) ? personId : undefined,
      minStrength: minStrength && !isNaN(minStrength) ? minStrength : undefined,
    });

    res.json(envelope(result.data, { total: result.total, page: result.page, totalPages: result.totalPages, limit }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch connections");
  }
});

router.get("/types", async (_req, res) => {
  try {
    const result = await storage.getConnectionTypes();
    res.json(envelope(result));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch connection types");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return sendError(res, 400, "BAD_REQUEST", "Invalid ID");

    const result = await storage.getConnectionById(id);
    if (!result) return sendError(res, 404, "NOT_FOUND", "Connection not found");

    res.json(envelope(result));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch connection");
  }
});

export default router;
