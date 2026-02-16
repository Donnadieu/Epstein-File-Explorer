import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

function getClientId(): string {
  let id = localStorage.getItem("epstein_client_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("epstein_client_id", id);
  }
  return id;
}

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

  const { data: votes = [], ...queryRest } = useQuery<DocumentVote[]>({
    queryKey: [...VOTES_KEY, clientId],
    queryFn: async () => {
      const res = await fetch(`/api/votes?userId=${encodeURIComponent(clientId)}`);
      if (!res.ok) throw new Error("Failed to fetch votes");
      return res.json();
    },
  });

  const sortedIds = useMemo(() => [...documentIds].sort((a, b) => a - b), [documentIds]);
  const idsKey = sortedIds.join(",");

  const { data: voteCounts = {} } = useQuery<Record<number, number>>({
    queryKey: [...VOTE_COUNTS_KEY, idsKey],
    queryFn: async () => {
      if (sortedIds.length === 0) return {};
      const res = await fetch(`/api/votes/counts?documentIds=${idsKey}`);
      if (!res.ok) throw new Error("Failed to fetch vote counts");
      return res.json();
    },
    enabled: sortedIds.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const res = await apiRequest("POST", "/api/votes", {
        documentId,
        userId: clientId,
      });
      return res.json() as Promise<DocumentVote>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VOTES_KEY });
      queryClient.invalidateQueries({ queryKey: VOTE_COUNTS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/votes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VOTES_KEY });
      queryClient.invalidateQueries({ queryKey: VOTE_COUNTS_KEY });
    },
  });

  function isVoted(documentId: number): DocumentVote | undefined {
    return votes.find((v) => v.documentId === documentId);
  }

  function getCount(documentId: number): number {
    return voteCounts[documentId] ?? 0;
  }

  function toggleVote(documentId: number) {
    const existing = isVoted(documentId);
    if (existing) {
      deleteMutation.mutate(existing.id);
    } else {
      createMutation.mutate(documentId);
    }
  }

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
