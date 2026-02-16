import { useState, useCallback } from "react";
import type { Document } from "@shared/schema";

export function useVideoPlayer() {
  const [videoDoc, setVideoDoc] = useState<Document | null>(null);

  const open = useCallback((doc: Document) => setVideoDoc(doc), []);
  const close = useCallback(() => setVideoDoc(null), []);

  return { videoDoc, isOpen: videoDoc !== null, open, close };
}
