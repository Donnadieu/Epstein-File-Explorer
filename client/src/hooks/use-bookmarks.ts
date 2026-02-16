import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getClientId } from "@/lib/client-id";
import type { Bookmark } from "@shared/schema";

const BOOKMARKS_KEY = ["/api/bookmarks"];

function toKey(entityType: string, entityId?: number | null, searchQuery?: string | null): string {
  if (entityType === "search") return `search:${searchQuery}`;
  return `${entityType}:${entityId}`;
}

export function useBookmarks() {
  const queryClient = useQueryClient();
  const clientId = getClientId();
  const queryKey = [...BOOKMARKS_KEY, clientId];

  // Local optimistic state for instant feedback
  const [pendingAdds, setPendingAdds] = useState<Set<string>>(new Set());
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());

  const { data: serverBookmarks = [], ...queryRest } = useQuery<Bookmark[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/bookmarks?userId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch bookmarks");
      return res.json();
    },
  });

  // Auto-clear pending state once server data catches up
  useEffect(() => {
    if (pendingAdds.size === 0 && pendingRemoves.size === 0) return;
    const serverKeys = new Set(serverBookmarks.map((b) => toKey(b.entityType, b.entityId, b.searchQuery)));
    let addsChanged = false;
    let removesChanged = false;
    const nextAdds = new Set(pendingAdds);
    const nextRemoves = new Set(pendingRemoves);

    for (const key of pendingAdds) {
      if (serverKeys.has(key)) { nextAdds.delete(key); addsChanged = true; }
    }
    for (const key of pendingRemoves) {
      if (!serverKeys.has(key)) { nextRemoves.delete(key); removesChanged = true; }
    }
    if (addsChanged) setPendingAdds(nextAdds);
    if (removesChanged) setPendingRemoves(nextRemoves);
  }, [serverBookmarks, pendingAdds, pendingRemoves]);

  // Merge server data with optimistic state
  const bookmarks = useMemo(() => {
    let result = serverBookmarks.filter((b) => !pendingRemoves.has(toKey(b.entityType, b.entityId, b.searchQuery)));
    for (const key of pendingAdds) {
      const alreadyExists = result.some((b) => toKey(b.entityType, b.entityId, b.searchQuery) === key);
      if (!alreadyExists) {
        const [entityType, rest] = key.split(":", 2);
        result = [...result, {
          id: -Date.now(),
          userId: clientId,
          entityType,
          entityId: entityType !== "search" ? Number(rest) : null,
          searchQuery: entityType === "search" ? rest : null,
          label: null,
          createdAt: new Date(),
        } as Bookmark];
      }
    }
    return result;
  }, [serverBookmarks, pendingAdds, pendingRemoves, clientId]);

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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: BOOKMARKS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bookmarks/${id}`);
    },
    onError: (_err, _id, context: { key: string } | undefined) => {
      // Rollback: remove from pendingRemoves so item reappears
      if (context?.key) {
        setPendingRemoves((prev) => { const next = new Set(prev); next.delete(context.key); return next; });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: BOOKMARKS_KEY });
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
    const key = toKey(entityType, entityId, searchQuery);
    const existing = bookmarks.find((b) => {
      if (b.entityType !== entityType) return false;
      if (entityType === "search") return b.searchQuery === searchQuery;
      return b.entityId === entityId;
    });

    if (existing) {
      if (existing.id < 0) {
        // Still optimistic (not yet on server) — just undo the pending add
        setPendingAdds((prev) => { const next = new Set(prev); next.delete(key); return next; });
      } else {
        setPendingRemoves((prev) => new Set(prev).add(key));
        deleteMutation.mutate(existing.id, { context: { key } } as any);
      }
    } else {
      setPendingAdds((prev) => new Set(prev).add(key));
      createMutation.mutate({ entityType, entityId, searchQuery, label });
    }
  }, [bookmarks, createMutation, deleteMutation]);

  const deleteBookmark = useCallback((id: number) => {
    const bookmark = serverBookmarks.find((b) => b.id === id);
    if (bookmark) {
      const key = toKey(bookmark.entityType, bookmark.entityId, bookmark.searchQuery);
      setPendingRemoves((prev) => new Set(prev).add(key));
      deleteMutation.mutate(id, { context: { key } } as any);
    } else {
      deleteMutation.mutate(id);
    }
  }, [serverBookmarks, deleteMutation]);

  return {
    bookmarks,
    searchBookmarks,
    personBookmarks,
    documentBookmarks,
    isBookmarked,
    toggleBookmark,
    createBookmark: createMutation.mutate,
    deleteBookmark,
    isLoading: queryRest.isLoading,
    isMutating: createMutation.isPending || deleteMutation.isPending,
  };
}
