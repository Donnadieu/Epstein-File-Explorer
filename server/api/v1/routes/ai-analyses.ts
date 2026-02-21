import { Router } from "express";
import { storage } from "../../../storage";
import { envelope, sendError, parsePageParams } from "../types";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { page, limit } = parsePageParams(req.query as any);
    const allAnalyses = await storage.getAIAnalysisList();
    const total = allAnalyses.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginated = allAnalyses.slice(offset, offset + limit);

    res.json(envelope(paginated, { total, page, totalPages, limit }));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch AI analyses");
  }
});

router.get("/aggregate", async (_req, res) => {
  try {
    const aggregate = await storage.getAIAnalysisAggregate();
    res.json(envelope(aggregate));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch AI analysis aggregate");
  }
});

router.get("/:fileName", async (req, res) => {
  try {
    const fileName = req.params.fileName;

    // Path traversal protection
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return sendError(res, 400, "BAD_REQUEST", "Invalid file name");
    }

    const analysis = await storage.getAIAnalysis(fileName);
    if (!analysis) return sendError(res, 404, "NOT_FOUND", "Analysis not found");

    res.json(envelope(analysis));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch AI analysis");
  }
});

export default router;
