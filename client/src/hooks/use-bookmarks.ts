import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Bookmark } from "@shared/schema";

const BOOKMARKS_KEY = ["/api/bookmarks"];

export function useBookmarks() {
  const queryClient = useQueryClient();

  const { data: bookmarks = [], ...queryRest } = useQuery<Bookmark[]>({
    queryKey: BOOKMARKS_KEY,
  });

  const createMutation = useMutation({
    mutationFn: async (params: {
      entityType: "person" | "document" | "search";
      entityId?: number;
      searchQuery?: string;
      label?: string;
    }) => {
      const res = await apiRequest("POST", "/api/bookmarks", params);
      return res.json() as Promise<Bookmark>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOOKMARKS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bookmarks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOOKMARKS_KEY });
    },
  });

  const searchBookmarks = useMemo(() => bookmarks.filter((b) => b.entityType === "search"), [bookmarks]);
  const personBookmarks = useMemo(() => bookmarks.filter((b) => b.entityType === "person"), [bookmarks]);
  const documentBookmarks = useMemo(() => bookmarks.filter((b) => b.entityType === "document"), [bookmarks]);

  function isBookmarked(entityType: string, entityId?: number, searchQuery?: string): Bookmark | undefined {
    return bookmarks.find((b) => {
      if (b.entityType !== entityType) return false;
      if (entityType === "search") return b.searchQuery === searchQuery;
      return b.entityId === entityId;
    });
  }

  function toggleBookmark(
    entityType: "person" | "document" | "search",
    entityId?: number,
    searchQuery?: string,
    label?: string,
  ) {
    const existing = isBookmarked(entityType, entityId, searchQuery);
    if (existing) {
      deleteMutation.mutate(existing.id);
    } else {
      createMutation.mutate({ entityType, entityId, searchQuery, label });
    }
  }

  return {
    bookmarks,
    searchBookmarks,
    personBookmarks,
    documentBookmarks,
    isBookmarked,
    toggleBookmark,
    createBookmark: createMutation.mutate,
    deleteBookmark: deleteMutation.mutate,
    isLoading: queryRest.isLoading,
    isMutating: createMutation.isPending || deleteMutation.isPending,
  };
}
