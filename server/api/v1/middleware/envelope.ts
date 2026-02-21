import type { Request, Response, NextFunction } from "express";

/**
 * Middleware that wraps JSON responses in the standard envelope: { data, meta }.
 * Skips responses that already have an `error` key (error handler sends those directly).
 * Skips non-JSON responses (CSV, binary streams).
 */
export function envelopeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    // Skip if the body already has the envelope shape or is an error
    if (body && (body.error || body.data !== undefined)) {
      return originalJson(body);
    }

    const wrapped = {
      data: body,
      meta: {
        apiVersion: "v1" as const,
        timestamp: new Date().toISOString(),
      },
    };
    return originalJson(wrapped);
  };

  next();
}
