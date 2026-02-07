import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowLeftRight,
  FileText,
  Check,
  X,
  Minus,
} from "lucide-react";
import type { Document } from "@shared/schema";

interface DocumentWithPersons extends Document {
  persons?: { id: number; name: string; mentionType: string }[];
}

interface DocsPage {
  data: Document[];
  total: number;
}

function useDocumentsList() {
  return useQuery<DocsPage>({
    queryKey: ["/api/documents?page=1&limit=100"],
  });
}

function useDocumentDetail(id: string | null) {
  return useQuery<DocumentWithPersons>({
    queryKey: ["/api/documents", id],
    enabled: !!id,
  });
}

function ComparisonRow({
  label,
  valueA,
  valueB,
}: {
  label: string;
  valueA: React.ReactNode;
  valueB: React.ReactNode;
}) {
  const strA = typeof valueA === "string" ? valueA : "";
  const strB = typeof valueB === "string" ? valueB : "";
  const isDifferent = strA !== strB && strA !== "" && strB !== "";

  return (
    <div
      className={`grid grid-cols-[140px_1fr_1fr] gap-3 py-2 px-3 rounded-sm ${
        isDifferent ? "bg-yellow-500/5" : ""
      }`}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm">{valueA || <Minus className="w-3 h-3 text-muted-foreground/40" />}</span>
      <span className="text-sm">{valueB || <Minus className="w-3 h-3 text-muted-foreground/40" />}</span>
    </div>
  );
}

function BoolBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) return <Badge variant="secondary" className="bg-destructive/10 text-destructive gap-1"><X className="w-3 h-3" /> Yes</Badge>;
  if (value === false) return <Badge variant="secondary" className="bg-green-500/10 text-green-600 gap-1"><Check className="w-3 h-3" /> No</Badge>;
  return <Minus className="w-3 h-3 text-muted-foreground/40" />;
}

export default function DocumentComparePage() {
  const searchParams = new URLSearchParams(window.location.search);
  const [docAId, setDocAId] = useState<string | null>(searchParams.get("a"));
  const [docBId, setDocBId] = useState<string | null>(searchParams.get("b"));

  const { data: docsPage, isLoading: listLoading } = useDocumentsList();
  const documents = docsPage?.data ?? [];
  const { data: docA, isLoading: loadingA } = useDocumentDetail(docAId);
  const { data: docB, isLoading: loadingB } = useDocumentDetail(docBId);

  const isLoading = loadingA || loadingB;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto w-full">
      <Link href="/documents">
        <Button variant="ghost" size="sm" className="gap-1 -ml-2" data-testid="button-back">
          <ArrowLeft className="w-4 h-4" /> Documents
        </Button>
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" data-testid="text-compare-title">
          <ArrowLeftRight className="w-5 h-5 text-primary" />
          Compare Documents
        </h1>
        <p className="text-sm text-muted-foreground">
          Select two documents to compare their metadata side by side.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">Document A</label>
          <Select value={docAId ?? ""} onValueChange={(v) => setDocAId(v || null)}>
            <SelectTrigger data-testid="select-doc-a">
              <SelectValue placeholder={listLoading ? "Loading..." : "Select document..."} />
            </SelectTrigger>
            <SelectContent>
              {documents.map((d) => (
                <SelectItem key={d.id} value={String(d.id)} disabled={String(d.id) === docBId}>
                  <span className="truncate">{d.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">Document B</label>
          <Select value={docBId ?? ""} onValueChange={(v) => setDocBId(v || null)}>
            <SelectTrigger data-testid="select-doc-b">
              <SelectValue placeholder={listLoading ? "Loading..." : "Select document..."} />
            </SelectTrigger>
            <SelectContent>
              {documents.map((d) => (
                <SelectItem key={d.id} value={String(d.id)} disabled={String(d.id) === docAId}>
                  <span className="truncate">{d.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {(!docAId || !docBId) && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <FileText className="w-10 h-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Select two documents above to compare.</p>
        </div>
      )}

      {docAId && docBId && isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {docA && docB && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4" /> Metadata Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {/* Header row */}
            <div className="grid grid-cols-[140px_1fr_1fr] gap-3 py-2 px-3 border-b">
              <span className="text-xs font-medium text-muted-foreground">Field</span>
              <Link href={`/documents/${docA.id}`}>
                <span className="text-xs font-semibold text-primary hover:underline truncate block">{docA.title}</span>
              </Link>
              <Link href={`/documents/${docB.id}`}>
                <span className="text-xs font-semibold text-primary hover:underline truncate block">{docB.title}</span>
              </Link>
            </div>

            <ComparisonRow label="Type" valueA={docA.documentType} valueB={docB.documentType} />
            <ComparisonRow label="Data Set" valueA={docA.dataSet ?? ""} valueB={docB.dataSet ?? ""} />
            <ComparisonRow label="Original Date" valueA={docA.dateOriginal ?? ""} valueB={docB.dateOriginal ?? ""} />
            <ComparisonRow label="Published Date" valueA={docA.datePublished ?? ""} valueB={docB.datePublished ?? ""} />
            <ComparisonRow label="Page Count" valueA={docA.pageCount ? String(docA.pageCount) : ""} valueB={docB.pageCount ? String(docB.pageCount) : ""} />
            <ComparisonRow
              label="Redacted"
              valueA={<BoolBadge value={docA.isRedacted} />}
              valueB={<BoolBadge value={docB.isRedacted} />}
            />
            <ComparisonRow label="Media Type" valueA={docA.mediaType ?? ""} valueB={docB.mediaType ?? ""} />
            <ComparisonRow label="Processing" valueA={docA.processingStatus ?? ""} valueB={docB.processingStatus ?? ""} />
            <ComparisonRow label="AI Analysis" valueA={docA.aiAnalysisStatus ?? ""} valueB={docB.aiAnalysisStatus ?? ""} />

            {(docA.tags?.length || docB.tags?.length) && (
              <ComparisonRow
                label="Tags"
                valueA={
                  docA.tags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {docA.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                    </div>
                  ) : ""
                }
                valueB={
                  docB.tags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {docB.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                    </div>
                  ) : ""
                }
              />
            )}

            <Separator className="my-2" />

            {/* People mentioned comparison */}
            <ComparisonRow
              label="People Mentioned"
              valueA={
                docA.persons?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {docA.persons.map((p) => {
                      const inBoth = docB.persons?.some((bp) => bp.id === p.id);
                      return (
                        <Badge
                          key={p.id}
                          variant={inBoth ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {p.name}
                        </Badge>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">None</span>
                )
              }
              valueB={
                docB.persons?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {docB.persons.map((p) => {
                      const inBoth = docA.persons?.some((ap) => ap.id === p.id);
                      return (
                        <Badge
                          key={p.id}
                          variant={inBoth ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {p.name}
                        </Badge>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">None</span>
                )
              }
            />

            {docA.keyExcerpt || docB.keyExcerpt ? (
              <>
                <Separator className="my-2" />
                <ComparisonRow
                  label="Key Excerpt"
                  valueA={docA.keyExcerpt ? <p className="text-xs italic text-muted-foreground">"{docA.keyExcerpt}"</p> : ""}
                  valueB={docB.keyExcerpt ? <p className="text-xs italic text-muted-foreground">"{docB.keyExcerpt}"</p> : ""}
                />
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
