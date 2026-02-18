import { useState, useCallback } from "react";
import type { Document } from "@shared/schema";

export function useDocumentViewer() {
  const [viewerDoc, setViewerDoc] = useState<Document | null>(null);

  const open = useCallback((doc: Document) => setViewerDoc(doc), []);
  const close = useCallback(() => setViewerDoc(null), []);

  return { viewerDoc, isOpen: viewerDoc !== null, open, close };
}
