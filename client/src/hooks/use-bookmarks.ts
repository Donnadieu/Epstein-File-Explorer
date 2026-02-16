import { useMemo, useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getClientId } from "@/lib/client-id";
import type { Bookmark } from "@shared/schema";

const BOOKMARKS_KEY = ["/api/bookmarks"];

export function useBookmarks() {
  const queryClient = useQueryClient();
  const clientId = getClientId();
  const queryKey = useMemo(() => [...BOOKMARKS_KEY, clientId], [clientId]);

  // Local optimistic state layered on top of server data
  const [pendingAdds, setPendingAdds] = useState<Bookmark[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set());

  const { data: serverBookmarks = [], ...queryRest } = useQuery<Bookmark[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/bookmarks?userId=${encodeURIComponent(clientId)}`);
      if (!res.ok) throw new Error("Failed to fetch bookmarks");
      return res.json();
    },
  });

  // Merge server data with optimistic local state
  const bookmarks = useMemo(() => {
    const filtered = serverBookmarks.filter((b) => !pendingDeletes.has(b.id));
    return [...filtered, ...pendingAdds];
  }, [serverBookmarks, pendingAdds, pendingDeletes]);

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
    onSuccess: () => {
      setPendingAdds([]);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      setPendingAdds([]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bookmarks/${id}`);
    },
    onSuccess: (_data, id) => {
      setPendingDeletes((prev) => { const next = new Set(prev); next.delete(id); return next; });
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (_err, id) => {
      setPendingDeletes((prev) => { const next = new Set(prev); next.delete(id); return next; });
    },
  });

  const searchBookmarks = useMemo(() => bookmarks.filter((b) => b.entityType === "search"), [bookmarks]);
  const personBookmarks = useMemo(() => bookmarks.filter((b) => b.entityType === "person"), [bookmarks]);
  const documentBookmarks = useMemo(() => bookmarks.filter((b) => b.entityType === "document"), [bookmarks]);

  const isBookmarked = useCallback((entityType: string, entityId?: number, searchQuery?: string): Bookmark | undefined => {
    return bookmarks.find((b) => {
      if (b.entityType !== entityType) return false;
      if (entityType === "search") return b.searchQuery === searchQuery;
      return b.entityId === entityId;
    });
  }, [bookmarks]);

  const toggleBookmark = useCallback((
    entityType: "person" | "document" | "search",
    entityId?: number,
    searchQuery?: string,
    label?: string,
  ) => {
    const existing = bookmarks.find((b) => {
      if (b.entityType !== entityType) return false;
      if (entityType === "search") return b.searchQuery === searchQuery;
      return b.entityId === entityId;
    });
    if (existing) {
      // Optimistic delete — hide immediately
      setPendingDeletes((prev) => new Set(prev).add(existing.id));
      deleteMutation.mutate(existing.id);
    } else {
      // Optimistic create — show immediately
      const optimistic: Bookmark = {
        id: -Date.now(),
        userId: clientId,
        entityType,
        entityId: entityId ?? null,
        searchQuery: searchQuery ?? null,
        label: label ?? null,
        createdAt: new Date(),
      };
      setPendingAdds((prev) => [...prev, optimistic]);
      createMutation.mutate({ entityType, entityId, searchQuery, label });
    }
  }, [bookmarks, clientId, createMutation, deleteMutation]);

  const handleDeleteBookmark = useCallback((id: number) => {
    setPendingDeletes((prev) => new Set(prev).add(id));
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  return {
    bookmarks,
    searchBookmarks,
    personBookmarks,
    documentBookmarks,
    isBookmarked,
    toggleBookmark,
    createBookmark: createMutation.mutate,
    deleteBookmark: handleDeleteBookmark,
    isLoading: queryRest.isLoading,
    isMutating: createMutation.isPending || deleteMutation.isPending,
  };
}
