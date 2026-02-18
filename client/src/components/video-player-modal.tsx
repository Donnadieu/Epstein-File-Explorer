import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Video, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { PublicDocument } from "@shared/schema";

interface VideoPlayerModalProps {
  doc: PublicDocument | null;
  open: boolean;
  onClose: () => void;
}

export function VideoPlayerModal({ doc, open, onClose }: VideoPlayerModalProps) {
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) setError(false);
  }, [open]);

  if (!doc) return null;

  const videoUrl = doc.publicUrl || `/api/documents/${doc.id}/video`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Video className="w-4 h-4" />
            <span className="truncate">{doc.title}</span>
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Video className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Could not load video.</p>
          </div>
        ) : (
          <video
            key={doc.id}
            src={videoUrl}
            controls
            autoPlay
            className="w-full max-h-[60vh] rounded-md bg-black"
            onError={() => setError(true)}
          />
        )}

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
