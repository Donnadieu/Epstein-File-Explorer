import pLimit from "p-limit";
import pRetry from "p-retry";

/**
 * Batch Processing Utilities for OpenRouter
 *
 * NOTE: Use the OpenRouter API to find available model names.
 * Do NOT guess model names - always verify with the API first.
 *
 * USAGE:
 * ```typescript
 * import { batchProcess } from "./replit_integrations/batch";
 * import OpenAI from "openai";
 *
 * const openrouter = new OpenAI({
 *   baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
 *   apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
 * });
 *
 * const results = await batchProcess(
 *   items,
 *   async (item) => {
 *     const response = await openrouter.chat.completions.create({
 *       model: "meta-llama/llama-3.3-70b-instruct", // verify model name via API
 *       messages: [{ role: "user", content: `Process: ${item.name}` }],
 *       max_tokens: 8192,
 *     });
 *     return response.choices[0]?.message?.content || "";
 *   }
 * );
 * ```
 */

export interface BatchOptions {
  /** Max concurrent requests (default: 2) */
  concurrency?: number;
  /** Max retry attempts for rate limit errors (default: 7) */
  retries?: number;
  /** Initial retry delay in ms (default: 2000) */
  minTimeout?: number;
  /** Max retry delay in ms (default: 128000) */
  maxTimeout?: number;
  /** Callback for progress updates */
  onProgress?: (completed: number, total: number, item: unknown) => void;
}

/**
 * Check if an error is a rate limit or quota violation.
 */
export function isRateLimitError(error: unknown): boolean {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return (
    errorMsg.includes("429") ||
    errorMsg.includes("RATELIMIT_EXCEEDED") ||
    errorMsg.toLowerCase().includes("quota") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

/**
 * Process items in batches with rate limiting and automatic retries.
 *
 * @param items - Array of items to process
 * @param processor - Async function to process each item (write your LLM logic here)
 * @param options - Concurrency and retry settings
 * @returns Promise resolving to array of results in the same order as input
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: BatchOptions = {}
): Promise<R[]> {
  const {
    concurrency = 2,
    retries = 7,
    minTimeout = 2000,
    maxTimeout = 128000,
    onProgress,
  } = options;

  const limit = pLimit(concurrency);
  let completed = 0;

  const promises = items.map((item, index) =>
    limit(() =>
      pRetry(
        async () => {
          try {
            const result = await processor(item, index);
            completed++;
            onProgress?.(completed, items.length, item);
            return result;
          } catch (error: unknown) {
            if (isRateLimitError(error)) {
              throw error;
            }
            throw new pRetry.AbortError(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        },
        { retries, minTimeout, maxTimeout, factor: 2 }
      )
    )
  );

  return Promise.all(promises);
}

/**
 * Process items sequentially with SSE progress streaming.
 */
export async function batchProcessWithSSE<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  sendEvent: (event: { type: string; [key: string]: unknown }) => void,
  options: Omit<BatchOptions, "concurrency" | "onProgress"> = {}
): Promise<R[]> {
  const { retries = 5, minTimeout = 1000, maxTimeout = 15000 } = options;

  sendEvent({ type: "started", total: items.length });

  const results: R[] = [];
  let errors = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    sendEvent({ type: "processing", index, item });

    try {
      const result = await pRetry(() => processor(item, index), {
        retries,
        minTimeout,
        maxTimeout,
        factor: 2,
        onFailedAttempt: (error) => {
          if (!isRateLimitError(error)) {
            throw new pRetry.AbortError(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        },
      });
      results.push(result);
      sendEvent({ type: "progress", index, result });
    } catch (error) {
      errors++;
      results.push(undefined as R);
      sendEvent({
        type: "progress",
        index,
        error: error instanceof Error ? error.message : "Processing failed",
      });
    }
  }

  sendEvent({ type: "complete", processed: items.length, errors });
  return results;
}
