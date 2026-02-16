import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getClientId } from "@/lib/client-id";

interface PersonVote {
  id: number;
  userId: string;
  personId: number;
  createdAt: string;
}

const VOTES_KEY = ["/api/person-votes"];
const VOTE_COUNTS_KEY = ["/api/person-votes/counts"];

export function usePersonVotes(personIds: number[] = []) {
  const queryClient = useQueryClient();
  const clientId = getClientId();

  const [pendingVotes, setPendingVotes] = useState<Set<number>>(new Set());
  const [pendingUnvotes, setPendingUnvotes] = useState<Set<number>>(new Set());

  const { data: serverVotes = [], ...queryRest } = useQuery<PersonVote[]>({
    queryKey: [...VOTES_KEY, clientId],
    queryFn: async () => {
      const res = await fetch(`/api/person-votes?userId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch person votes");
      return res.json();
    },
  });

  const sortedIds = useMemo(() => [...personIds].sort((a, b) => a - b), [personIds]);
  const idsKey = sortedIds.join(",");

  const { data: serverCounts = {} } = useQuery<Record<number, number>>({
    queryKey: [...VOTE_COUNTS_KEY, idsKey],
    queryFn: async () => {
      if (sortedIds.length === 0) return {};
      const res = await fetch(`/api/person-votes/counts?personIds=${idsKey}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch person vote counts");
      return res.json();
    },
    enabled: sortedIds.length > 0,
  });

  useEffect(() => {
    if (pendingVotes.size === 0 && pendingUnvotes.size === 0) return;
    const serverVotedIds = new Set(serverVotes.map((v) => v.personId));
    let votesChanged = false;
    let unvotesChanged = false;
    const nextVotes = new Set(pendingVotes);
    const nextUnvotes = new Set(pendingUnvotes);

    for (const id of pendingVotes) {
      if (serverVotedIds.has(id)) { nextVotes.delete(id); votesChanged = true; }
    }
    for (const id of pendingUnvotes) {
      if (!serverVotedIds.has(id)) { nextUnvotes.delete(id); unvotesChanged = true; }
    }
    if (votesChanged) setPendingVotes(nextVotes);
    if (unvotesChanged) setPendingUnvotes(nextUnvotes);
  }, [serverVotes, pendingVotes, pendingUnvotes]);

  const votes = useMemo(() => {
    let result = serverVotes.filter((v) => !pendingUnvotes.has(v.personId));
    for (const id of pendingVotes) {
      if (!result.some((v) => v.personId === id)) {
        result = [...result, {
          id: -Date.now(),
          userId: clientId,
          personId: id,
          createdAt: new Date().toISOString(),
        }];
      }
    }
    return result;
  }, [serverVotes, pendingVotes, pendingUnvotes, clientId]);

  const voteCounts = useMemo(() => {
    const counts = { ...serverCounts };
    for (const id of pendingVotes) {
      if (!serverVotes.some((v) => v.personId === id)) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    for (const id of pendingUnvotes) {
      if (serverVotes.some((v) => v.personId === id)) {
        counts[id] = Math.max(0, (counts[id] ?? 0) - 1);
      }
    }
    return counts;
  }, [serverCounts, serverVotes, pendingVotes, pendingUnvotes]);

  const createMutation = useMutation({
    mutationFn: async (personId: number) => {
      const res = await apiRequest("POST", "/api/person-votes", { personId, userId: clientId });
      return res.json() as Promise<PersonVote>;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: VOTES_KEY });
      queryClient.invalidateQueries({ queryKey: VOTE_COUNTS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/person-votes/${id}`);
    },
    onError: (_err: unknown, _id: number, context: { personId: number } | undefined) => {
      if (context?.personId) {
        setPendingUnvotes((prev) => { const next = new Set(prev); next.delete(context.personId); return next; });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: VOTES_KEY });
      queryClient.invalidateQueries({ queryKey: VOTE_COUNTS_KEY });
    },
  });

  const isVoted = useCallback((personId: number): PersonVote | undefined => {
    return votes.find((v) => v.personId === personId);
  }, [votes]);

  const getCount = useCallback((personId: number): number => {
    return voteCounts[personId] ?? 0;
  }, [voteCounts]);

  const toggleVote = useCallback((personId: number) => {
    const existing = votes.find((v) => v.personId === personId);
    if (existing) {
      if (existing.id < 0) {
        setPendingVotes((prev) => { const next = new Set(prev); next.delete(personId); return next; });
      } else {
        setPendingUnvotes((prev) => new Set(prev).add(personId));
        deleteMutation.mutate(existing.id, { context: { personId } } as any);
      }
    } else {
      setPendingVotes((prev) => new Set(prev).add(personId));
      createMutation.mutate(personId);
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
