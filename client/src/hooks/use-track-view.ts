import { useEffect, useRef } from "react";
import { getClientId } from "@/lib/client-id";

export function useTrackView(entityType: "person" | "document", entityId: string | undefined) {
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    if (!entityId) return;
    const key = `${entityType}-${entityId}`;
    if (tracked.current === key) return;
    tracked.current = key;

    const id = parseInt(entityId, 10);
    if (isNaN(id)) return;

    fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, entityId: id, sessionId: getClientId() }),
    }).catch(() => {});
  }, [entityType, entityId]);
}
