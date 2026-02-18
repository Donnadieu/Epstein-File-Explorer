import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

export function useViewCounts(entityType: "person" | "document", ids: number[]) {
  const sortedIds = useMemo(() => [...ids].sort((a, b) => a - b), [ids]);
  const idsKey = sortedIds.join(",");

  const { data: viewCounts = {} } = useQuery<Record<number, number>>({
    queryKey: ["/api/view-counts", entityType, idsKey],
    queryFn: async () => {
      if (sortedIds.length === 0) return {};
      const res = await fetch(`/api/view-counts?entityType=${entityType}&ids=${idsKey}`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: sortedIds.length > 0,
    staleTime: 60_000,
  });

  const getViewCount = useCallback(
    (id: number): number => viewCounts[id] ?? 0,
    [viewCounts],
  );

  return { viewCounts, getViewCount };
}
