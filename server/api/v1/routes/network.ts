import { Router } from "express";
import { storage } from "../../../storage";
import { envelope, sendError } from "../types";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const data = await storage.getNetworkData();
    res.json(envelope(data));
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", "Failed to fetch network data");
  }
});

export default router;
