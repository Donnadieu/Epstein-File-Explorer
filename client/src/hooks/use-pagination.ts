import { useMemo } from "react";

interface PaginationResult<T> {
  paginated: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  startIndex: number;
}

export function usePagination<T>(
  items: T[] | undefined,
  pageStr: string,
  itemsPerPage: number,
): PaginationResult<T> {
  return useMemo(() => {
    const totalItems = items?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const currentPage = Math.min(Math.max(1, parseInt(pageStr) || 1), totalPages);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginated = items?.slice(startIndex, startIndex + itemsPerPage) || [];
    return { paginated, totalItems, totalPages, currentPage, startIndex };
  }, [items, pageStr, itemsPerPage]);
}
