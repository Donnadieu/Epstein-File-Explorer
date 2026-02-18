import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { FileText, ExternalLink, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import PdfViewer from "@/components/pdf-viewer";
import type { PublicDocument } from "@shared/schema";

interface DocumentViewerModalProps {
  doc: PublicDocument | null;
  open: boolean;
  onClose: () => void;
}

export function DocumentViewerModal({ doc, open, onClose }: DocumentViewerModalProps) {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!open) setImageError(false);
  }, [open]);

  if (!doc) return null;

  const mediaType = doc.mediaType?.toLowerCase() || "";
  const docType = doc.documentType?.toLowerCase() || "";
  const isPdf = doc.sourceUrl?.toLowerCase().endsWith(".pdf");
  const isPhoto =
    !isPdf &&
    (mediaType === "photo" ||
      mediaType === "image" ||
      docType === "photograph");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isPhoto ? (
              <ImageIcon className="w-4 h-4" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            <span className="truncate">{doc.title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto">
          {isPhoto ? (
            imageError ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <ImageIcon className="w-10 h-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Could not load image.</p>
                {doc.sourceUrl && (
                  <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5" />
                      View on DOJ
                    </Button>
                  </a>
                )}
              </div>
            ) : (
              <img
                key={doc.id}
                src={doc.publicUrl || `/api/documents/${doc.id}/image`}
                alt={doc.title}
                className="max-w-full max-h-[70vh] rounded-md mx-auto"
                onError={() => setImageError(true)}
              />
            )
          ) : (
            <PdfViewer
              documentId={doc.id}
              sourceUrl={doc.sourceUrl ?? undefined}
              publicUrl={doc.publicUrl}
            />
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Link href={`/documents/${doc.id}`} onClick={onClose}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" />
              View full details
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
