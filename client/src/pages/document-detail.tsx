import PdfViewer from "@/components/pdf-viewer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useTrackView } from "@/hooks/use-track-view";
import type { AIAnalysisConnection, AIAnalysisDocument, AIAnalysisEvent, AIAnalysisPerson, Document, Person, PublicDocument } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Hash,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  MapPin,
  Scale,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useImportanceVotes } from "@/hooks/use-importance-votes";
import { ImportanceVoteButton } from "@/components/importance-vote-button";

const EFTA_PATTERN = /^[A-Z]{2,6}[-_]?\d{4,}/i;

function getDisplayTitle(doc: PublicDocument): string {
  const trimmed = doc.title.trim();
  if (!EFTA_PATTERN.test(trimmed)) return doc.title;

  // Prefer AI-generated description if available
  if (doc.description) {
    return doc.description.length > 80
      ? doc.description.slice(0, 77) + "..."
      : doc.description;
  }

  const typeName = doc.documentType
    ? doc.documentType.charAt(0).toUpperCase() + doc.documentType.slice(1)
    : "Document";
  const setInfo = doc.dataSet ? ` (Set ${doc.dataSet})` : "";
  const dateInfo = doc.dateOriginal ? ` - ${doc.dateOriginal}` : "";
  return `${typeName}${setInfo}${dateInfo}`;
}

interface DocumentEvent {
  id: number;
  date: string;
  title: string;
  description: string;
  category: string;
  significance: number;
  persons?: { id: number; name: string }[];
}

interface PageTypeInfo {
  pageNumber: number;
  pageType: string;
}

interface DocumentDetail extends PublicDocument {
  persons: (Person & { mentionType: string; context: string | null })[];
  timelineEvents?: DocumentEvent[];
  pageTypes?: PageTypeInfo[];
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  useTrackView("document", params.id);
  const [, navigate] = useLocation();
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const searchParams = new URLSearchParams(window.location.search);
  const initialPage = parseInt(searchParams.get("page") || "1", 10) || 1;

  const { data: doc, isLoading } = useQuery<DocumentDetail>({
    queryKey: ["/api/documents", params.id],
  });

  const { data: adjacent } = useQuery<{
    prev: number | null;
    next: number | null;
  }>({
    queryKey: [`/api/documents/${params.id}/adjacent`],
    enabled: !!params.id,
  });

  const aiFileName = doc?.title?.trim().match(EFTA_PATTERN)
    ? doc.title.trim().endsWith(".pdf")
      ? doc.title.trim()
      : `${doc.title.trim()}.pdf`
    : null;

  const { data: aiAnalysis } = useQuery<AIAnalysisDocument>({
    queryKey: ["/api/ai-analyses", aiFileName],
    queryFn: async () => {
      const res = await fetch(
        `/api/ai-analyses/${encodeURIComponent(aiFileName!)}`,
      );
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!aiFileName,
    retry: false,
  });

  const voteDocIds = useMemo(() => doc ? [doc.id] : [], [doc?.id]);
  const { isVoted, getCount, toggleVote } = useImportanceVotes(voteDocIds);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "ArrowLeft" && adjacent?.prev)
        navigate(`/documents/${adjacent.prev}`);
      if (e.key === "ArrowRight" && adjacent?.next)
        navigate(`/documents/${adjacent.next}`);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [adjacent, navigate]);

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
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 -ml-2"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" /> Documents
          </Button>
        </Link>
        {adjacent && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={!adjacent.prev}
              onClick={() =>
                adjacent.prev && navigate(`/documents/${adjacent.prev}`)
              }
              data-testid="button-prev-doc"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={!adjacent.next}
              onClick={() =>
                adjacent.next && navigate(`/documents/${adjacent.next}`)
              }
              data-testid="button-next-doc"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
        <div className="flex items-center gap-1">
          <ImportanceVoteButton
            documentId={doc.id}
            isVoted={!!isVoted(doc.id)}
            count={getCount(doc.id)}
            onToggle={toggleVote}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() =>
              toggleBookmark("document", doc.id, undefined, doc.title)
            }
            aria-label={
              isBookmarked("document", doc.id)
                ? `Remove bookmark: ${doc.title}`
                : `Bookmark ${doc.title}`
            }
          >
            {isBookmarked("document", doc.id) ? (
              <BookmarkCheck className="w-4 h-4 text-primary" />
            ) : (
              <Bookmark className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
          <Link href={`/documents/compare?a=${doc.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              data-testid="button-compare"
            >
              <ArrowLeftRight className="w-4 h-4" /> Compare
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-md bg-muted shrink-0">
            <Icon className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <h1
              className="text-xl font-bold tracking-tight"
              data-testid="text-document-title"
            >
              {getDisplayTitle(doc)}
            </h1>
            {EFTA_PATTERN.test(doc.title.trim()) && (
              <span className="text-xs font-mono text-muted-foreground">
                Ref: {doc.title}
              </span>
            )}
            {doc.description && (
              <p className="text-sm text-muted-foreground">{doc.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline">{doc.documentType}</Badge>
          {doc.dataSet && (
            <Badge variant="secondary">Data Set {doc.dataSet}</Badge>
          )}
          {doc.isRedacted && (
            <Badge
              variant="secondary"
              className="bg-destructive/10 text-destructive"
            >
              Contains Redactions
            </Badge>
          )}
          {doc.tags?.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {doc.dateOriginal && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">
                    Original Date
                  </span>
                  <span className="text-xs font-medium">
                    {doc.dateOriginal}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
          {doc.datePublished && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">
                    Published
                  </span>
                  <span className="text-xs font-medium">
                    {doc.datePublished}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
          {doc.pageCount && (
            <Card>
              <CardContent className="p-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">
                    Pages
                  </span>
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
                  <span className="text-[10px] text-muted-foreground uppercase">
                    Data Set
                  </span>
                  <span className="text-xs font-medium">{doc.dataSet}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {doc.pageTypes &&
          doc.pageTypes.length > 0 &&
          (() => {
            const typeCounts = new Map<string, number>();
            for (const pt of doc.pageTypes) {
              if (pt.pageType)
                typeCounts.set(
                  pt.pageType,
                  (typeCounts.get(pt.pageType) || 0) + 1,
                );
            }
            if (typeCounts.size <= 1) return null;
            const sorted = Array.from(typeCounts.entries()).sort(
              (a, b) => b[1] - a[1],
            );
            return (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium">
                  Contains:
                </span>
                {sorted.map(([type, count]) => (
                  <Badge key={type} variant="secondary" className="text-[10px]">
                    {count} {type}
                    {count > 1 ? "s" : ""}
                  </Badge>
                ))}
              </div>
            );
          })()}

        {doc.sourceUrl && (
          <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
            <Button
              variant="outline"
              className="gap-2 w-fit"
              data-testid="button-view-source"
            >
              <ExternalLink className="w-4 h-4" /> View Original on DOJ
            </Button>
          </a>
        )}
      </div>

      {(doc.sourceUrl || doc.documentType) && (
        <>
          <Separator />

          {aiAnalysis && (
            <AIAnalysisSection analysis={aiAnalysis} />
          )}

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" /> Document Viewer
            </h2>
            <DocumentViewer doc={doc} initialPage={initialPage} />
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
                <p className="text-sm text-muted-foreground italic leading-relaxed">
                  "{doc.keyExcerpt}"
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> People Mentioned (
          {doc.persons?.length || 0})
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
                  <Card
                    className="hover-elevate cursor-pointer"
                    data-testid={`card-person-${person.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8 border border-border">
                          {person.imageUrl && (
                            <AvatarImage
                              src={person.imageUrl}
                              alt={person.name}
                            />
                          )}
                          <AvatarFallback className="text-xs bg-muted">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="text-sm font-medium">
                            {person.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {person.mentionType}
                            </Badge>
                            {person.context && (
                              <span className="text-[10px] text-muted-foreground truncate">
                                {person.context}
                              </span>
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
            <p className="text-sm text-muted-foreground">
              No linked individuals.
            </p>
          </div>
        )}
      </div>

      {/* Related Timeline Events */}
      {doc.timelineEvents && doc.timelineEvents.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Related Events (
              {doc.timelineEvents.length})
            </h2>
            <div className="flex flex-col gap-2">
              {doc.timelineEvents.map((event) => (
                <Card key={event.id} data-testid={`card-event-${event.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <span className="text-[11px] font-mono text-muted-foreground shrink-0 pt-0.5">
                        {event.date}
                      </span>
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <span className="text-sm font-medium">
                          {event.title}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {event.description}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <Badge variant="outline" className="text-[10px]">
                            {event.category}
                          </Badge>
                          {event.persons?.map((p) => (
                            <Link key={p.id} href={`/people/${p.id}`}>
                              <Badge
                                variant="secondary"
                                className="text-[10px] cursor-pointer hover:bg-primary/10"
                              >
                                {p.name}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AIAnalysisSection({ analysis }: { analysis: AIAnalysisDocument }) {
  const [factsOpen, setFactsOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [personsOpen, setPersonsOpen] = useState(false);

  const hasPersons = analysis.persons && analysis.persons.length > 0;
  const hasConnections = analysis.connections && analysis.connections.length > 0;
  const hasEvents = analysis.events && analysis.events.length > 0;
  const hasLocations = analysis.locations && analysis.locations.length > 0;
  const hasKeyFacts = analysis.keyFacts && analysis.keyFacts.length > 0;

  if (!analysis.summary && !hasPersons && !hasConnections && !hasEvents && !hasLocations && !hasKeyFacts) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" /> AI Analysis
      </h2>
      <Card className="bg-muted/30">
        <CardContent className="p-4 flex flex-col gap-4">
          {analysis.summary && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {analysis.summary}
            </p>
          )}

          {/* Stat badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {hasPersons && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Users className="w-3 h-3" /> {analysis.persons!.length} people
              </Badge>
            )}
            {hasConnections && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Link2 className="w-3 h-3" /> {analysis.connections!.length} connections
              </Badge>
            )}
            {hasEvents && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Clock className="w-3 h-3" /> {analysis.events!.length} events
              </Badge>
            )}
            {hasLocations && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <MapPin className="w-3 h-3" /> {analysis.locations!.length} locations
              </Badge>
            )}
            {hasKeyFacts && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <BookOpen className="w-3 h-3" /> {analysis.keyFacts!.length} key facts
              </Badge>
            )}
          </div>

          {/* Key Facts */}
          {hasKeyFacts && (
            <CollapsibleList
              label="Key Facts"
              count={analysis.keyFacts!.length}
              open={factsOpen}
              onToggle={() => setFactsOpen(!factsOpen)}
            >
              <ul className="space-y-1.5 pl-5">
                {analysis.keyFacts!.map((fact, i) => (
                  <li key={i} className="text-xs text-muted-foreground list-disc leading-relaxed">
                    {fact}
                  </li>
                ))}
              </ul>
            </CollapsibleList>
          )}

          {/* Persons identified by AI */}
          {hasPersons && (
            <CollapsibleList
              label="People Identified"
              count={analysis.persons!.length}
              open={personsOpen}
              onToggle={() => setPersonsOpen(!personsOpen)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {analysis.persons!.map((person, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-medium truncate">{person.name}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {person.role && (
                          <span className="text-[10px] text-muted-foreground truncate">{person.role}</span>
                        )}
                        {person.category && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0">{person.category}</Badge>
                        )}
                      </div>
                    </div>
                    {person.mentionCount != null && person.mentionCount > 1 && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{person.mentionCount}x</span>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleList>
          )}

          {/* Connections */}
          {hasConnections && (
            <CollapsibleList
              label="Connections"
              count={analysis.connections!.length}
              open={connectionsOpen}
              onToggle={() => setConnectionsOpen(!connectionsOpen)}
            >
              <div className="space-y-1.5">
                {analysis.connections!.map((conn, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{conn.person1}</span>
                    <span className="text-muted-foreground">—</span>
                    <span className="text-muted-foreground italic truncate flex-1">
                      {conn.relationshipType || conn.type || "connected"}
                    </span>
                    <span className="text-muted-foreground">—</span>
                    <span className="font-medium">{conn.person2}</span>
                    {conn.strength != null && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        ({conn.strength}/10)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleList>
          )}

          {/* Events */}
          {hasEvents && (
            <CollapsibleList
              label="Events"
              count={analysis.events!.length}
              open={eventsOpen}
              onToggle={() => setEventsOpen(!eventsOpen)}
            >
              <div className="space-y-2">
                {analysis.events!.map((event, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {event.date && (
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0 pt-0.5">
                        {event.date}
                      </span>
                    )}
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-xs font-medium">{event.title}</span>
                      {event.description && (
                        <span className="text-[11px] text-muted-foreground leading-relaxed">
                          {event.description}
                        </span>
                      )}
                    </div>
                    {event.significance != null && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                        {event.significance}/10
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleList>
          )}

          {/* Locations */}
          {hasLocations && (
            <CollapsibleList
              label="Locations"
              count={analysis.locations!.length}
              open={locationsOpen}
              onToggle={() => setLocationsOpen(!locationsOpen)}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                {analysis.locations!.map((loc, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] gap-1">
                    <MapPin className="w-2.5 h-2.5" /> {loc}
                  </Badge>
                ))}
              </div>
            </CollapsibleList>
          )}

          {/* Analysis metadata */}
          {analysis.analyzedAt && (
            <span className="text-[10px] text-muted-foreground/60 pt-1">
              Analyzed {new Date(analysis.analyzedAt).toLocaleDateString()}
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CollapsibleList({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {label} ({count})
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function VideoPlayer({ doc }: { doc: DocumentDetail }) {
  const [error, setError] = useState(false);
  const videoUrl = doc.publicUrl || `/api/documents/${doc.id}/video`;

  return (
    <Card className="bg-muted/30 overflow-hidden">
      <CardContent className="p-4 flex flex-col items-center gap-4">
        {error ? (
          <div className="flex flex-col items-center gap-2">
            <Video className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Could not load video.</p>
            {doc.sourceUrl && (
              <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="gap-2">
                  <ExternalLink className="w-4 h-4" /> View on DOJ
                </Button>
              </a>
            )}
          </div>
        ) : (
          <video
            src={videoUrl}
            controls
            className="max-w-full max-h-[70vh] rounded-lg shadow-md"
            onError={() => setError(true)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function DocumentViewer({
  doc,
  initialPage,
}: {
  doc: DocumentDetail;
  initialPage?: number;
}) {
  const mediaType = doc.mediaType?.toLowerCase() || "";
  const docType = doc.documentType?.toLowerCase() || "";
  const isPdf = doc.sourceUrl?.toLowerCase().endsWith(".pdf");
  const isPhoto =
    !isPdf &&
    (mediaType === "photo" ||
      mediaType === "image" ||
      docType === "photograph");
  const isVideo = mediaType === "video" || docType === "video";

  if (isPhoto) {
    return (
      <Card className="bg-muted/30 overflow-hidden">
        <CardContent className="p-4 flex flex-col items-center gap-4">
          <img
            src={doc.publicUrl || `/api/documents/${doc.id}/image`}
            alt={doc.title}
            className="max-w-full max-h-[70vh] rounded-lg shadow-md"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              const sibling = (e.target as HTMLImageElement).nextElementSibling;
              if (sibling) {
                sibling.classList.remove("hidden");
                sibling.classList.add("flex");
              }
            }}
          />
          <div className="hidden flex-col items-center gap-2">
            <ImageIcon className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Could not load image.
            </p>
            {doc.sourceUrl && (
              <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="gap-2">
                  <ExternalLink className="w-4 h-4" /> View on DOJ
                </Button>
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isVideo) {
    return <VideoPlayer doc={doc} />;
  }

  // Default: try PDF viewer, which will show a graceful fallback if it fails
  return (
    <PdfViewer
      documentId={doc.id}
      sourceUrl={doc.sourceUrl ?? undefined}
      publicUrl={doc.publicUrl}
      initialPage={initialPage}
      pageTypes={doc.pageTypes}
    />
  );
}
