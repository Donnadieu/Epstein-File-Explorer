import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  ExternalLink,
  AlertCircle,
  Loader2,
} from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfViewerProps {
  documentId: number;
  sourceUrl: string;
}

type ViewerState = "loading" | "ready" | "error";

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export default function PdfViewer({ documentId, sourceUrl }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [viewerState, setViewerState] = useState<ViewerState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageInputValue, setPageInputValue] = useState("1");

  const renderPage = useCallback(
    async (pageNum: number) => {
      const pdfDoc = pdfDocRef.current;
      const canvas = canvasRef.current;
      if (!pdfDoc || !canvas) return;

      // Cancel any ongoing render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderTask = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        renderTaskRef.current = null;
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("PDF render error:", err);
        }
      }
    },
    [scale],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setViewerState("loading");

      // Try proxy endpoint first (avoids CORS), then direct URL
      const urls = [`/api/documents/${documentId}/pdf`, sourceUrl];

      for (const url of urls) {
        if (cancelled) return;
        try {
          const doc = await pdfjsLib.getDocument({ url }).promise;
          if (cancelled) {
            doc.destroy();
            return;
          }
          pdfDocRef.current = doc;
          setTotalPages(doc.numPages);
          setCurrentPage(1);
          setPageInputValue("1");
          setViewerState("ready");
          return;
        } catch {
          // Try next URL
        }
      }

      if (!cancelled) {
        setErrorMessage("Could not load PDF. The source may block direct access.");
        setViewerState("error");
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    };
  }, [documentId, sourceUrl]);

  useEffect(() => {
    if (viewerState === "ready") {
      renderPage(currentPage);
    }
  }, [currentPage, scale, viewerState, renderPage]);

  const goToPage = (page: number) => {
    const clamped = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(clamped);
    setPageInputValue(String(clamped));
  };

  const handlePageInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const num = parseInt(pageInputValue, 10);
      if (!isNaN(num)) goToPage(num);
    }
  };

  const zoomIn = () => setScale((s) => Math.min(s + ZOOM_STEP, MAX_ZOOM));
  const zoomOut = () => setScale((s) => Math.max(s - ZOOM_STEP, MIN_ZOOM));

  const fitToWidth = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !pdfDocRef.current) return;

    pdfDocRef.current.getPage(currentPage).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = container.clientWidth - 32; // account for padding
      const newScale = containerWidth / viewport.width;
      setScale(Math.max(MIN_ZOOM, Math.min(newScale, MAX_ZOOM)));
    });
  }, [currentPage]);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  if (viewerState === "error") {
    return (
      <Card className="bg-muted/30">
        <CardContent className="flex flex-col items-center gap-3 py-8">
          <AlertCircle className="w-8 h-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground text-center">{errorMessage}</p>
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="gap-2">
              <ExternalLink className="w-4 h-4" /> View Original on DOJ
            </Button>
          </a>
        </CardContent>
      </Card>
    );
  }

  if (viewerState === "loading") {
    return (
      <Card className="bg-muted/30">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading PDF...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col border rounded-lg overflow-hidden ${isFullscreen ? "bg-background" : ""}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/50 border-b flex-wrap">
        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-1 text-sm">
            <input
              type="text"
              value={pageInputValue}
              onChange={(e) => setPageInputValue(e.target.value)}
              onKeyDown={handlePageInput}
              onBlur={() => {
                const num = parseInt(pageInputValue, 10);
                if (!isNaN(num)) goToPage(num);
                else setPageInputValue(String(currentPage));
              }}
              className="w-10 h-7 text-center text-sm border rounded bg-background"
            />
            <span className="text-muted-foreground">/ {totalPages}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomOut} disabled={scale <= MIN_ZOOM}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <button
            onClick={fitToWidth}
            className="text-xs text-muted-foreground hover:text-foreground min-w-[3.5rem] text-center"
          >
            {Math.round(scale * 100)}%
          </button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomIn} disabled={scale >= MAX_ZOOM}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Canvas area */}
      <div className={`overflow-auto bg-muted/20 flex justify-center p-4 ${isFullscreen ? "flex-1" : "max-h-[70vh]"}`}>
        <canvas ref={canvasRef} className="shadow-md" />
      </div>
    </div>
  );
}
