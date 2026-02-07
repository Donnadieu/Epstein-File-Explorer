import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { useUrlFilters } from "@/hooks/use-url-filters";
import type { Document } from "@shared/schema";

const ITEMS_PER_PAGE = 50;

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
    page: "1",
  });

  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const documentTypes = ["all", ...Array.from(new Set(documents?.map((d) => d.documentType) || []))];
  const dataSets = ["all", ...Array.from(new Set(documents?.filter((d) => d.dataSet).map((d) => d.dataSet!) || []))].sort();

  const filtered = useMemo(() => {
    return documents?.filter((doc) => {
      const matchesSearch =
        !filters.search ||
        doc.title.toLowerCase().includes(filters.search.toLowerCase()) ||
        (doc.description || "").toLowerCase().includes(filters.search.toLowerCase()) ||
        (doc.keyExcerpt || "").toLowerCase().includes(filters.search.toLowerCase());
      const matchesType = filters.type === "all" || doc.documentType === filters.type;
      const matchesDataSet = filters.dataSet === "all" || doc.dataSet === filters.dataSet;
      const matchesRedacted =
        filters.redacted === "all" ||
        (filters.redacted === "redacted" && doc.isRedacted) ||
        (filters.redacted === "unredacted" && !doc.isRedacted);
      return matchesSearch && matchesType && matchesDataSet && matchesRedacted;
    });
  }, [documents, filters.search, filters.type, filters.dataSet, filters.redacted]);

  const totalItems = filtered?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  const currentPage = Math.min(Math.max(1, parseInt(filters.page) || 1), totalPages);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginated = filtered?.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const activeFilters = Object.entries(filters).filter(
    ([key, value]) =>
      key !== "page" &&
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
          Document Browser
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
                            <span className="text-sm font-semibold">{doc.title}</span>
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

          {totalItems === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <FileText className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground text-center max-w-md">
                No documents match these filters.
                {filters.search && ` Try a different search term.`}
                {filters.type !== "all" && ` Try removing the "${filters.type}" type filter.`}
                {filters.redacted !== "all" && ` Try removing the "${filters.redacted}" filter.`}
                {filters.dataSet !== "all" && ` Try removing the "Data Set ${filters.dataSet}" filter.`}
              </p>
              {activeFilters.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {activeFilters.map(([key, value]) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => setFilter(key, ["type", "dataSet", "redacted"].includes(key) ? "all" : "")}
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
