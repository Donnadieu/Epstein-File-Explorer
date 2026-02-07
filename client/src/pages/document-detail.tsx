import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ArrowLeftRight,
  FileText,
  Clock,
  ExternalLink,
  Users,
  Scale,
  AlertTriangle,
  BookOpen,
  Hash,
  Layers,
  Eye,
} from "lucide-react";
import PdfViewer from "@/components/pdf-viewer";
import type { Document, Person } from "@shared/schema";

interface DocumentDetail extends Document {
  persons: (Person & { mentionType: string; context: string | null })[];
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();

  const { data: doc, isLoading } = useQuery<DocumentDetail>({
    queryKey: ["/api/documents", params.id],
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-96" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <FileText className="w-12 h-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">Document not found.</p>
        <Link href="/documents">
          <Button variant="outline" size="sm" data-testid="button-back-to-docs">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to documents
          </Button>
        </Link>
      </div>
    );
  }

  const typeIcons: Record<string, any> = {
    "court filing": Scale,
    "fbi report": AlertTriangle,
    deposition: Scale,
  };
  const Icon = typeIcons[doc.documentType] || FileText;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <Link href="/documents">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Documents
          </Button>
        </Link>
        <Link href={`/documents/compare?a=${doc.id}`}>
          <Button variant="outline" size="sm" className="gap-1" data-testid="button-compare">
            <ArrowLeftRight className="w-4 h-4" /> Compare
          </Button>
        </Link>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-md bg-muted shrink-0">
            <Icon className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight" data-testid="text-document-title">{doc.title}</h1>
            {doc.description && (
              <p className="text-sm text-muted-foreground">{doc.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline">{doc.documentType}</Badge>
          {doc.dataSet && <Badge variant="secondary">Data Set {doc.dataSet}</Badge>}
          {doc.isRedacted && (
            <Badge variant="secondary" className="bg-destructive/10 text-destructive">
              Contains Redactions
            </Badge>
          )}
          {doc.tags?.map((tag) => (
            <Badge key={tag} variant="secondary">{tag}</Badge>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {doc.dateOriginal && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">Original Date</span>
                  <span className="text-xs font-medium">{doc.dateOriginal}</span>
                </div>
              </CardContent>
            </Card>
          )}
          {doc.datePublished && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">Published</span>
                  <span className="text-xs font-medium">{doc.datePublished}</span>
                </div>
              </CardContent>
            </Card>
          )}
          {doc.pageCount && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">Pages</span>
                  <span className="text-xs font-medium">{doc.pageCount}</span>
                </div>
              </CardContent>
            </Card>
          )}
          {doc.dataSet && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <Hash className="w-4 h-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">Data Set</span>
                  <span className="text-xs font-medium">{doc.dataSet}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {doc.sourceUrl && (
          <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="gap-2 w-fit" data-testid="button-view-source">
              <ExternalLink className="w-4 h-4" /> View Original on DOJ
            </Button>
          </a>
        )}
      </div>

      {doc.sourceUrl && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" /> Document Viewer
            </h2>
            <PdfViewer documentId={doc.id} sourceUrl={doc.sourceUrl} />
          </div>
        </>
      )}

      {doc.keyExcerpt && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" /> Key Excerpt
            </h2>
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground italic leading-relaxed">"{doc.keyExcerpt}"</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> People Mentioned ({doc.persons?.length || 0})
        </h2>
        {doc.persons && doc.persons.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {doc.persons.map((person) => {
              const initials = person.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2);
              return (
                <Link key={person.id} href={`/people/${person.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`card-person-${person.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 border border-border">
                          <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="text-sm font-medium">{person.name}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">{person.mentionType}</Badge>
                            {person.context && (
                              <span className="text-[10px] text-muted-foreground truncate">{person.context}</span>
                            )}
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
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Users className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No linked individuals.</p>
          </div>
        )}
      </div>
    </div>
  );
}
