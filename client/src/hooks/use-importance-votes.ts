import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getClientId } from "@/lib/client-id";

interface DocumentVote {
  id: number;
  userId: string;
  documentId: number;
  createdAt: string;
}

const VOTES_KEY = ["/api/votes"];
const VOTE_COUNTS_KEY = ["/api/votes/counts"];

export function useImportanceVotes(documentIds: number[] = []) {
  const queryClient = useQueryClient();
  const clientId = getClientId();

  // Optimistic local state
  const [pendingVotes, setPendingVotes] = useState<Set<number>>(new Set());
  const [pendingUnvotes, setPendingUnvotes] = useState<Set<number>>(new Set());

  const { data: serverVotes = [], ...queryRest } = useQuery<DocumentVote[]>({
    queryKey: [...VOTES_KEY, clientId],
    queryFn: async () => {
      const res = await fetch(`/api/votes?userId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch votes");
      return res.json();
    },
  });

  const sortedIds = useMemo(() => [...documentIds].sort((a, b) => a - b), [documentIds]);
  const idsKey = sortedIds.join(",");

  const { data: serverCounts = {} } = useQuery<Record<number, number>>({
    queryKey: [...VOTE_COUNTS_KEY, idsKey],
    queryFn: async () => {
      if (sortedIds.length === 0) return {};
      const res = await fetch(`/api/votes/counts?documentIds=${idsKey}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch vote counts");
      return res.json();
    },
    enabled: sortedIds.length > 0,
  });

  // Auto-clear pending state when server catches up
  useEffect(() => {
    if (pendingVotes.size === 0 && pendingUnvotes.size === 0) return;
    const serverVotedIds = new Set(serverVotes.map((v) => v.documentId));
    let votesChanged = false;
    let unvotesChanged = false;
    const nextVotes = new Set(pendingVotes);
    const nextUnvotes = new Set(pendingUnvotes);

    for (const docId of pendingVotes) {
      if (serverVotedIds.has(docId)) { nextVotes.delete(docId); votesChanged = true; }
    }
    for (const docId of pendingUnvotes) {
      if (!serverVotedIds.has(docId)) { nextUnvotes.delete(docId); unvotesChanged = true; }
    }
    if (votesChanged) setPendingVotes(nextVotes);
    if (unvotesChanged) setPendingUnvotes(nextUnvotes);
  }, [serverVotes, pendingVotes, pendingUnvotes]);

  // Merge server data with optimistic state
  const votes = useMemo(() => {
    let result = serverVotes.filter((v) => !pendingUnvotes.has(v.documentId));
    for (const docId of pendingVotes) {
      if (!result.some((v) => v.documentId === docId)) {
        result = [...result, {
          id: -Date.now(),
          userId: clientId,
          documentId: docId,
          createdAt: new Date().toISOString(),
        }];
      }
    }
    return result;
  }, [serverVotes, pendingVotes, pendingUnvotes, clientId]);

  // Optimistic vote counts
  const voteCounts = useMemo(() => {
    const counts = { ...serverCounts };
    for (const docId of pendingVotes) {
      if (!serverVotes.some((v) => v.documentId === docId)) {
        counts[docId] = (counts[docId] ?? 0) + 1;
      }
    }
    for (const docId of pendingUnvotes) {
      if (serverVotes.some((v) => v.documentId === docId)) {
        counts[docId] = Math.max(0, (counts[docId] ?? 0) - 1);
      }
    }
    return counts;
  }, [serverCounts, serverVotes, pendingVotes, pendingUnvotes]);

  const createMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const res = await apiRequest("POST", "/api/votes", { documentId, userId: clientId });
      return res.json() as Promise<DocumentVote>;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: VOTES_KEY });
      queryClient.invalidateQueries({ queryKey: VOTE_COUNTS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/votes/${id}`);
    },
    onError: (_err, _id, context: { docId: number } | undefined) => {
      if (context?.docId) {
        setPendingUnvotes((prev) => { const next = new Set(prev); next.delete(context.docId); return next; });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: VOTES_KEY });
      queryClient.invalidateQueries({ queryKey: VOTE_COUNTS_KEY });
    },
  });

  const isVoted = useCallback((documentId: number): DocumentVote | undefined => {
    return votes.find((v) => v.documentId === documentId);
  }, [votes]);

  const getCount = useCallback((documentId: number): number => {
    return voteCounts[documentId] ?? 0;
  }, [voteCounts]);

  const toggleVote = useCallback((documentId: number) => {
    const existing = votes.find((v) => v.documentId === documentId);
    if (existing) {
      if (existing.id < 0) {
        // Still optimistic — just undo the pending vote
        setPendingVotes((prev) => { const next = new Set(prev); next.delete(documentId); return next; });
      } else {
        setPendingUnvotes((prev) => new Set(prev).add(documentId));
        deleteMutation.mutate(existing.id, { context: { docId: documentId } } as any);
      }
    } else {
      setPendingVotes((prev) => new Set(prev).add(documentId));
      createMutation.mutate(documentId);
    }
  }, [votes, createMutation, deleteMutation]);

  return {
    votes,
    voteCounts,
    isVoted,
    getCount,
    toggleVote,
    isLoading: queryRest.isLoading,
    isMutating: createMutation.isPending || deleteMutation.isPending,
  };
}
