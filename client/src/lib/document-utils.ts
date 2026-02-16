import type { Document } from "@shared/schema";

export function isVideoDocument(doc: Document): boolean {
  const mediaType = doc.mediaType?.toLowerCase() || "";
  const docType = doc.documentType?.toLowerCase() || "";
  return mediaType === "video" || docType === "video";
}
