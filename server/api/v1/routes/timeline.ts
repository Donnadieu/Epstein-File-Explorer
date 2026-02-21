import { Router } from "express";
import { storage } from "../../../storage";
import { envelope, sendError, parsePageParams } from "../types";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { page, limit } = parsePageParams(req.query as any);
    const category = req.query.category as string | undefined;
    const yearFrom = req.query.yearFrom as string | undefined;
    const yearTo = req.query.yearTo as string | undefined;
    const significance = req.query.significance ? parseInt(req.query.significance as string) : undefined;

    const result = await storage.getTimelineFiltered({
      page, limit, category, yearFrom, yearTo, significance,
    });

    res.json(envelope(result.data, { total: result.total, page: result.page, totalPages: result.totalPages, limit }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch timeline events");
  }
});

export default router;
