import rateLimit from "express-rate-limit";

function createLimiter(windowMs: number, max: number) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { code: "RATE_LIMITED", message: `Too many requests. Limit: ${max} per ${windowMs / 60000} minute(s).` },
      meta: { apiVersion: "v1", timestamp: new Date().toISOString() },
    },
  });
}

/** 100 req/min — default for all v1 routes */
export const generalLimiter = createLimiter(60_000, 100);

/** 30 req/min — /search, /search/pages */
export const searchLimiter = createLimiter(60_000, 30);

/** 10 req/min — /export/* */
export const exportLimiter = createLimiter(60_000, 10);

/** 10 req/min — /network */
export const networkLimiter = createLimiter(60_000, 10);
