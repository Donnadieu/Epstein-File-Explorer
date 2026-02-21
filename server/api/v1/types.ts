import type { Response } from "express";

export interface ApiMeta {
  apiVersion: "v1";
  timestamp: string;
  total?: number;
  page?: number;
  totalPages?: number;
  limit?: number;
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
  meta: { apiVersion: "v1"; timestamp: string };
}

export function envelope<T>(
  data: T,
  pagination?: { total: number; page: number; totalPages: number; limit: number },
): ApiResponse<T> {
  const meta: ApiMeta = {
    apiVersion: "v1",
    timestamp: new Date().toISOString(),
  };
  if (pagination) {
    meta.total = pagination.total;
    meta.page = pagination.page;
    meta.totalPages = pagination.totalPages;
    meta.limit = pagination.limit;
  }
  return { data, meta };
}

export function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    error: { code, message },
    meta: { apiVersion: "v1", timestamp: new Date().toISOString() },
  });
}

export function parsePageParams(query: { page?: string; limit?: string }): { page: number; limit: number } {
  const page = Math.max(1, parseInt(query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string || "50") || 50));
  return { page, limit };
}

export function parseId(raw: string): number | null {
  const id = parseInt(raw);
  return isNaN(id) ? null : id;
}
