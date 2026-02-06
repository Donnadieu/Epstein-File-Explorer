import { useState } from "react";
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
  ArrowUpDown,
  ExternalLink,
  Filter,
} from "lucide-react";
import type { Document } from "@shared/schema";

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

export default function DocumentsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dataSetFilter, setDataSetFilter] = useState("all");
  const [redactedFilter, setRedactedFilter] = useState("all");

  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const documentTypes = ["all", ...Array.from(new Set(documents?.map((d) => d.documentType) || []))];
  const dataSets = ["all", ...Array.from(new Set(documents?.filter((d) => d.dataSet).map((d) => d.dataSet!) || []))].sort();

  const filtered = documents?.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.description || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.keyExcerpt || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || doc.documentType === typeFilter;
    const matchesDataSet = dataSetFilter === "all" || doc.dataSet === dataSetFilter;
    const matchesRedacted =
      redactedFilter === "all" ||
      (redactedFilter === "redacted" && doc.isRedacted) ||
      (redactedFilter === "unredacted" && !doc.isRedacted);
    return matchesSearch && matchesType && matchesDataSet && matchesRedacted;
  });

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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-document-search"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
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
          <Select value={dataSetFilter} onValueChange={setDataSetFilter}>
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
          <Select value={redactedFilter} onValueChange={setRedactedFilter}>
            <SelectTrigger className="w-36" data-testid="select-redacted-filter">
              <SelectValue placeholder="Redaction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="redacted">Redacted</SelectItem>
              <SelectItem value="unredacted">Unredacted</SelectItem>
            </SelectContent>
          </Select>
          {(typeFilter !== "all" || dataSetFilter !== "all" || redactedFilter !== "all" || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setTypeFilter("all");
                setDataSetFilter("all");
                setRedactedFilter("all");
              }}
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
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {filtered?.length || 0} of {documents?.length || 0} documents
          </p>
          <div className="flex flex-col gap-2">
            {filtered?.map((doc) => {
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
          {filtered?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <FileText className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No documents match your filters.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setTypeFilter("all");
                  setDataSetFilter("all");
                  setRedactedFilter("all");
                }}
                data-testid="button-clear-filters-empty"
              >
                Clear all filters
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
