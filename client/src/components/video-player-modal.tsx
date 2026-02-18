import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Video, ExternalLink, AlertCircle } from "lucide-react";
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

type ErrorType = "not-found" | "network" | "generic" | null;

export function VideoPlayerModal({ doc, open, onClose }: VideoPlayerModalProps) {
  const [errorType, setErrorType] = useState<ErrorType>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) setErrorType(null);
  }, [open]);

  const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      setErrorType("generic");
      return;
    }

    // MediaError code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED (often 404/403)
    // networkState 3 = NETWORK_NO_SOURCE
    if (video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || video.networkState === 3) {
      setErrorType("not-found");
    } else if (video.error?.code === MediaError.MEDIA_ERR_NETWORK) {
      setErrorType("network");
    } else {
      setErrorType("generic");
    }
  }, []);

  if (!doc) return null;

  const videoUrl = doc.publicUrl || `/api/documents/${doc.id}/video`;

  const errorMessages: Record<NonNullable<ErrorType>, string> = {
    "not-found": "This video is no longer available. It may have been removed from the source.",
    "network": "Could not connect to load this video. Please check your connection and try again.",
    "generic": "Could not load video.",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Video className="w-4 h-4" />
            <span className="truncate">{doc.title}</span>
          </DialogTitle>
        </DialogHeader>

        {errorType ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <AlertCircle className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center max-w-sm">{errorMessages[errorType]}</p>
            {doc.sourceUrl && (
              <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Try source on DOJ
                </Button>
              </a>
            )}
          </div>
        ) : (
          <video
            ref={videoRef}
            key={doc.id}
            src={videoUrl}
            controls
            autoPlay
            className="w-full max-h-[60vh] rounded-md bg-black"
            onError={handleVideoError}
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
