import { useRef, useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText,
  Search,
  Scale,
  AlertTriangle,
  Clock,
  Mail,
  Image,
  ExternalLink,
  Filter,
  ChevronLeft,
  ChevronRight,
  X,
  Video,
  LayoutGrid,
  List,
} from "lucide-react";
import { useUrlFilters } from "@/hooks/use-url-filters";
import type { Document } from "@shared/schema";

const ITEMS_PER_PAGE = 50;

/** Detect if a document title is just an EFTA reference number or other non-descriptive ID */
const EFTA_PATTERN = /^[A-Z]{2,6}[-_]?\d{4,}/i;
const NON_DESCRIPTIVE_PATTERN = /^(data[_\s-]?set[_\s-]?\d|set[_\s-]?\d|doc[_\s-]?\d|file[_\s-]?\d|page[_\s-]?\d)/i;

function isNonDescriptiveTitle(title: string): boolean {
  const trimmed = title.trim();
  return EFTA_PATTERN.test(trimmed) || NON_DESCRIPTIVE_PATTERN.test(trimmed);
}

function getDisplayTitle(doc: Document): string {
  if (!isNonDescriptiveTitle(doc.title)) return doc.title;

  // Prefer AI-generated description if available
  if (doc.description) {
    return doc.description.length > 80
      ? doc.description.slice(0, 77) + "..."
      : doc.description;
  }

  // Fallback to type + set + date
  const typeName = doc.documentType
    ? doc.documentType.charAt(0).toUpperCase() + doc.documentType.slice(1)
    : "Document";
  const setInfo = doc.dataSet ? ` (Set ${doc.dataSet})` : "";
  const dateInfo = doc.dateOriginal ? ` - ${doc.dateOriginal}` : "";

  return `${typeName}${setInfo}${dateInfo}`;
}

const typeIcons: Record<string, any> = {
  "flight log": Clock,
  "court filing": Scale,
  email: Mail,
  photograph: Image,
  "fbi report": AlertTriangle,
  deposition: Scale,
  "contact list": FileText,
  "financial record": FileText,
  correspondence: Mail,
  "witness statement": FileText,
};

const filterLabels: Record<string, string> = {
  search: "Search",
  type: "Type",
  dataSet: "Data Set",
  redacted: "Redaction",
  mediaType: "Media Type",
};

const pageTitles: Record<string, string> = {
  "court filing": "Court Filings",
  correspondence: "Correspondence",
  "fbi report": "FBI Reports",
  deposition: "Depositions",
  "flight log": "Flight Logs",
  "financial record": "Financial Records",
  "grand jury transcript": "Grand Jury Transcripts",
  "search warrant": "Search Warrants",
  "police report": "Police Reports",
  "property record": "Property Records",
  "news article": "News Articles",
  "travel record": "Travel Records",
  "government record": "Government Records",
};

const mediaTypeTitles: Record<string, string> = {
  image: "Photos",
  video: "Videos",
  pdf: "PDFs",
  email: "Emails",
  spreadsheet: "Spreadsheets",
};

function DocumentCardSkeleton({ index }: { index: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3" style={{ animationDelay: `${index * 75}ms` }}>
          <Skeleton className="w-10 h-10 rounded-md shrink-0" />
          <div className="flex flex-col gap-1.5 flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="flex gap-2 mt-1">
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-4 w-14 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DocumentsPage() {
  const [filters, setFilter, resetFilters] = useUrlFilters({
    search: "",
    type: "all",
    dataSet: "all",
    redacted: "all",
    mediaType: "all",
    page: "1",
    view: "grid",
  });

  const viewMode = filters.view === "list" ? "list" : "grid";

  const currentPage = Math.max(1, parseInt(filters.page) || 1);

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(currentPage));
  queryParams.set("limit", String(ITEMS_PER_PAGE));
  if (filters.search) queryParams.set("search", filters.search);
  if (filters.type !== "all") queryParams.set("type", filters.type);
  if (filters.dataSet !== "all") queryParams.set("dataSet", filters.dataSet);
  if (filters.redacted !== "all") queryParams.set("redacted", filters.redacted);
  if (filters.mediaType !== "all") queryParams.set("mediaType", filters.mediaType);

  const pageTitle = filters.type !== "all"
    ? (pageTitles[filters.type] || filters.type.charAt(0).toUpperCase() + filters.type.slice(1))
    : filters.mediaType !== "all"
      ? (mediaTypeTitles[filters.mediaType] || filters.mediaType.charAt(0).toUpperCase() + filters.mediaType.slice(1))
      : "Document Browser";

  const { data: result, isLoading } = useQuery<{ data: Document[]; total: number; page: number; totalPages: number }>({
    queryKey: [`/api/documents?${queryParams.toString()}`],
    placeholderData: keepPreviousData,
  });

  const { data: filterOptions } = useQuery<{ types: string[]; dataSets: string[]; mediaTypes: string[] }>({
    queryKey: ["/api/documents/filters"],
  });

  const documentTypes = ["all", ...(filterOptions?.types || [])];
  const dataSets = ["all", ...(filterOptions?.dataSets || [])];
  const mediaTypes = ["all", ...(filterOptions?.mediaTypes || [])];

  const paginated = result?.data;
  const totalItems = result?.total || 0;
  const totalPages = result?.totalPages || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;

  const activeFilters = Object.entries(filters).filter(
    ([key, value]) =>
      key !== "page" && key !== "view" &&
      value !== "" && value !== "all"
  );

  const hasActiveFilters = activeFilters.length > 0;

  const goToPage = (page: number) => setFilter("page", String(page));
  const resetPage = () => setFilter("page", "1");

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-documents-title">
          <FileText className="w-6 h-6 text-primary" />
          {pageTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          Browse publicly released documents from DOJ disclosures, court records, and congressional releases.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative w-full max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search documents..."
            value={filters.search}
            onChange={(e) => {
              setFilter("search", e.target.value);
              resetPage();
            }}
            className="pl-9"
            data-testid="input-document-search"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <Select value={filters.type} onValueChange={(v) => { setFilter("type", v); resetPage(); }}>
            <SelectTrigger className="w-40" data-testid="select-type-filter">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {documentTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type === "all" ? "All Types" : type.charAt(0).toUpperCase() + type.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.dataSet} onValueChange={(v) => { setFilter("dataSet", v); resetPage(); }}>
            <SelectTrigger className="w-36" data-testid="select-dataset-filter">
              <SelectValue placeholder="Data Set" />
            </SelectTrigger>
            <SelectContent>
              {dataSets.map((ds) => (
                <SelectItem key={ds} value={ds}>
                  {ds === "all" ? "All Sets" : `Data Set ${ds}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.redacted} onValueChange={(v) => { setFilter("redacted", v); resetPage(); }}>
            <SelectTrigger className="w-36" data-testid="select-redacted-filter">
              <SelectValue placeholder="Redaction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="redacted">Redacted</SelectItem>
              <SelectItem value="unredacted">Unredacted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.mediaType} onValueChange={(v) => { setFilter("mediaType", v); resetPage(); }}>
            <SelectTrigger className="w-36" data-testid="select-media-type-filter">
              <SelectValue placeholder="Media Type" />
            </SelectTrigger>
            <SelectContent>
              {mediaTypes.map((mt) => (
                <SelectItem key={mt} value={mt}>
                  {mt === "all" ? "All Media" : mt.charAt(0).toUpperCase() + mt.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              data-testid="button-clear-filters"
            >
              Clear
            </Button>
          )}
          <div className="ml-auto flex items-center border rounded-md">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-r-none"
              onClick={() => setFilter("view", "list")}
              data-testid="button-view-list"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-l-none"
              onClick={() => setFilter("view", "grid")}
              data-testid="button-view-grid"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <DocumentCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {totalItems === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + ITEMS_PER_PAGE, totalItems)} of {totalItems} documents
          </p>
          {viewMode === "list" ? (
            <div className="flex flex-col gap-2">
              {paginated?.map((doc) => {
                const Icon = typeIcons[doc.documentType] || FileText;
                return (
                  <Link key={doc.id} href={`/documents/${doc.id}`}>
                    <Card className="hover-elevate cursor-pointer" data-testid={`card-document-${doc.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-muted shrink-0">
                            <Icon className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-semibold truncate">{getDisplayTitle(doc)}</span>
                                {isNonDescriptiveTitle(doc.title) && (
                                  <Badge variant="outline" className="text-[9px] font-mono shrink-0">{doc.title}</Badge>
                                )}
                              </div>
                              {doc.sourceUrl && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    window.open(doc.sourceUrl!, "_blank", "noopener,noreferrer");
                                  }}
                                  data-testid={`button-source-${doc.id}`}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                            {doc.description && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
                            )}
                            {doc.keyExcerpt && (
                              <p className="text-xs text-muted-foreground/80 italic line-clamp-1 mt-0.5">
                                "{doc.keyExcerpt}"
                              </p>
                            )}
                            <div className="flex items-center gap-2 flex-wrap mt-1.5">
                              <Badge variant="outline" className="text-[10px]">{doc.documentType}</Badge>
                              {doc.dataSet && (
                                <Badge variant="secondary" className="text-[10px]">Set {doc.dataSet}</Badge>
                              )}
                              {doc.dateOriginal && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" /> {doc.dateOriginal}
                                </span>
                              )}
                              {doc.pageCount && (
                                <span className="text-[10px] text-muted-foreground">{doc.pageCount} pages</span>
                              )}
                              {doc.isRedacted && (
                                <Badge variant="secondary" className="text-[10px] bg-destructive/10 text-destructive">
                                  Redacted
                                </Badge>
                              )}
                              {doc.tags?.map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginated?.map((doc) => (
                <Link key={doc.id} href={`/documents/${doc.id}`}>
                  <div className="group cursor-pointer" data-testid={`grid-card-${doc.id}`}>
                    <div className="aspect-[3/4] rounded-lg overflow-hidden bg-muted border relative flex items-center justify-center transition-shadow group-hover:shadow-md group-hover:border-primary/30">
                      <DocumentThumbnail doc={doc} />
                    </div>
                    <p className="text-xs font-medium mt-1.5 line-clamp-2 leading-tight">
                      {getDisplayTitle(doc)}
                    </p>
                    {doc.dateOriginal && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                        <Clock className="w-2.5 h-2.5" /> {doc.dateOriginal}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {totalItems === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <FileText className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground text-center max-w-md">
                No documents match these filters.
                {filters.search && ` Try a different search term.`}
                {filters.type !== "all" && ` Try removing the "${filters.type}" type filter.`}
                {filters.redacted !== "all" && ` Try removing the "${filters.redacted}" filter.`}
                {filters.dataSet !== "all" && ` Try removing the "Data Set ${filters.dataSet}" filter.`}
                {filters.mediaType !== "all" && ` Try removing the "${filters.mediaType}" media type filter.`}
              </p>
              {activeFilters.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {activeFilters.map(([key, value]) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => setFilter(key as keyof typeof filters, ["type", "dataSet", "redacted"].includes(key) ? "all" : "")}
                    >
                      {filterLabels[key] || key}: {value}
                      <X className="w-3 h-3" />
                    </Button>
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" onClick={resetFilters} data-testid="button-clear-filters-empty">
                Clear all filters
              </Button>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-3">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => goToPage(currentPage + 1)}
                data-testid="button-next-page"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PdfThumbnail({ docId }: { docId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ url: `/api/documents/${docId}/pdf` }).promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1 });
        const scale = canvas.width / viewport.width;
        const scaledViewport = page.getViewport({ scale });
        canvas.height = scaledViewport.height;

        await page.render({
          canvasContext: canvas.getContext("2d")!,
          viewport: scaledViewport,
          canvas,
        }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; };
  }, [docId]);

  if (failed) return null;
  return <canvas ref={canvasRef} width={400} className="w-full h-full object-cover" />;
}

function DocumentThumbnail({ doc }: { doc: Document }) {
  const mediaType = doc.mediaType?.toLowerCase() || "";
  const docType = doc.documentType?.toLowerCase() || "";
  const isPhoto = mediaType === "photo" || mediaType === "image" || docType === "photograph";
  const isVideo = mediaType === "video" || docType === "video";
  const isPdf = doc.title?.toLowerCase().endsWith(".pdf");
  const Icon = typeIcons[doc.documentType] || FileText;

  if (isPhoto) {
    return (
      <img
        src={`/api/documents/${doc.id}/image`}
        alt={doc.title}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  if (isVideo) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <Video className="w-8 h-8 text-muted-foreground/40" />
        <span className="text-[10px] text-muted-foreground">Video</span>
      </div>
    );
  }

  if (isPdf) {
    return <PdfThumbnail docId={doc.id} />;
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Icon className="w-8 h-8 text-muted-foreground/40" />
      {doc.pageCount && (
        <span className="text-[10px] text-muted-foreground">{doc.pageCount} pg</span>
      )}
    </div>
  );
}
