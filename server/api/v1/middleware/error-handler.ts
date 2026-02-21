import type { Request, Response, NextFunction } from "express";

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};

export function v1ErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  const status = err.status || err.statusCode || 500;
  const code = STATUS_CODES[status] || "INTERNAL_ERROR";
  const message = err.message || "Internal Server Error";

  if (status >= 500) {
    console.error("v1 API error:", err);
  }

  res.status(status).json({
    error: { code, message },
    meta: { apiVersion: "v1", timestamp: new Date().toISOString() },
  });
}
