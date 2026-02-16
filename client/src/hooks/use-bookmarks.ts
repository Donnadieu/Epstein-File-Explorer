import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getClientId } from "@/lib/client-id";
import type { Bookmark } from "@shared/schema";

const BOOKMARKS_KEY = ["/api/bookmarks"];

export function useBookmarks() {
  const queryClient = useQueryClient();

  const clientId = getClientId();

  const { data: bookmarks = [], ...queryRest } = useQuery<Bookmark[]>({
    queryKey: [...BOOKMARKS_KEY, clientId],
    queryFn: async () => {
      const res = await fetch(`/api/bookmarks?userId=${encodeURIComponent(clientId)}`);
      if (!res.ok) throw new Error("Failed to fetch bookmarks");
      return res.json();
    },
  });

  const cacheKey = [...BOOKMARKS_KEY, clientId];

  const createMutation = useMutation({
    mutationFn: async (params: {
      entityType: "person" | "document" | "search";
      entityId?: number;
      searchQuery?: string;
      label?: string;
    }) => {
      const res = await apiRequest("POST", "/api/bookmarks", { ...params, userId: clientId });
      return res.json() as Promise<Bookmark>;
    },
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const previous = queryClient.getQueryData<Bookmark[]>(cacheKey);
      const optimistic: Bookmark = {
        id: -Date.now(),
        userId: clientId,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        searchQuery: params.searchQuery ?? null,
        label: params.label ?? null,
        createdAt: new Date(),
      };
      queryClient.setQueryData<Bookmark[]>(cacheKey, (old = []) => [...old, optimistic]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(cacheKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: BOOKMARKS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bookmarks/${id}`);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const previous = queryClient.getQueryData<Bookmark[]>(cacheKey);
      queryClient.setQueryData<Bookmark[]>(cacheKey, (old = []) => old.filter((b) => b.id !== id));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(cacheKey, context.previous);
    },
    onSettled: () => {
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
