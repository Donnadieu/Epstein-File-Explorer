import { ExportButton } from "@/components/export-button";
import { PersonHoverCard } from "@/components/person-hover-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useTrackView } from "@/hooks/use-track-view";
import type {
  Connection,
  Document,
  Person,
  ProfileSection,
  TimelineEvent,
} from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Briefcase,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Network,
  Scale,
  Sparkles,
  Users
} from "lucide-react";
import { useVideoPlayer } from "@/hooks/use-video-player";
import { isVideoDocument } from "@/lib/document-utils";
import { VideoPlayerModal } from "@/components/video-player-modal";
import { Link, useParams } from "wouter";

interface PersonAIMentions {
  keyFacts: string[];
  locations: string[];
  mentionCount: number;
  documentMentions: { fileName: string; context: string; role: string }[];
}

interface PersonDetail extends Person {
  documents: Document[];
  connections: (Connection & { person: Person })[];
  timelineEvents?: TimelineEvent[];
  aiMentions?: PersonAIMentions;
  emailDocCount?: number;
}

const categoryColors: Record<string, string> = {
  "key figure": "bg-destructive/10 text-destructive",
  associate: "bg-primary/10 text-primary",
  victim: "bg-chart-4/10 text-chart-4",
  witness: "bg-chart-3/10 text-chart-3",
  legal: "bg-chart-2/10 text-chart-2",
  political: "bg-chart-5/10 text-chart-5",
};

export default function PersonDetail() {
  const params = useParams<{ id: string }>();
  useTrackView("person", params.id);
  const { isBookmarked, toggleBookmark } = useBookmarks();

  const { data: person, isLoading } = useQuery<PersonDetail>({
    queryKey: ["/api/persons", params.id],
  });

  const videoPlayer = useVideoPlayer();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-4">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-6 w-64 mb-2" />
            <Skeleton className="h-4 w-48 mb-4" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <Users className="w-12 h-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">Person not found.</p>
        <Link href="/people">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-back-to-people"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to directory
          </Button>
        </Link>
      </div>
    );
  }

  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const allowedSections = new Set(["Summary", "Background"]);
  const profileSections = (
    (person.profileSections as ProfileSection[] | null) ?? []
  ).filter((s) => allowedSections.has(s.title));
  const hasOverview =
    profileSections.length > 0 ||
    (person.aiMentions && person.aiMentions.keyFacts.length > 0);
  const hasTimeline = person.timelineEvents && person.timelineEvents.length > 0;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <Link href="/people">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 -ml-2"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" /> People Directory
        </Button>
      </Link>

      <div className="flex flex-col sm:flex-row items-start gap-4">
        <Avatar className="w-20 h-20 border-2 border-border shrink-0">
          {person.imageUrl && (
            <AvatarImage src={person.imageUrl} alt={person.name} />
          )}
          <AvatarFallback className="text-2xl font-bold bg-muted">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h1
                className="text-2xl font-bold tracking-tight"
                data-testid="text-person-name"
              >
                {person.name}
              </h1>
              {person.aliases && person.aliases.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Also known as: {person.aliases.join(", ")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Badge
                variant="secondary"
                className={`${categoryColors[person.category] || ""}`}
              >
                {person.category}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() =>
                  toggleBookmark("person", person.id, undefined, person.name)
                }
                aria-label={
                  isBookmarked("person", person.id)
                    ? `Remove bookmark: ${person.name}`
                    : `Bookmark ${person.name}`
                }
              >
                {isBookmarked("person", person.id) ? (
                  <BookmarkCheck className="w-4 h-4 text-primary" />
                ) : (
                  <Bookmark className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground">
            {person.occupation && (
              <span className="flex items-center gap-1">
                <Briefcase className="w-3 h-3" /> {person.occupation}
              </span>
            )}
            {person.nationality && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {person.nationality}
              </span>
            )}
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" /> {person.documentCount} documents
            </span>
            <span className="flex items-center gap-1">
              <Network className="w-3 h-3" /> {person.connectionCount}{" "}
              connections
            </span>
            {(person.emailDocCount ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" /> {person.emailDocCount} emails
              </span>
            )}
            {person.aiMentions && person.aiMentions.mentionCount > 0 && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3" />{" "}
                {person.aiMentions.mentionCount} AI mentions
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground mt-1">
            {person.description}
          </p>

          {person.wikipediaUrl && (
            <a
              href={person.wikipediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1 w-fit"
            >
              <ExternalLink className="w-3 h-3" /> View on Wikipedia
            </a>
          )}
        </div>
      </div>

      <Tabs
        defaultValue={hasOverview ? "overview" : "documents"}
        className="w-full"
      >
        <TabsList
          data-testid="tabs-person-detail"
          className="flex-wrap h-auto gap-1"
        >
          {hasOverview && (
            <TabsTrigger value="overview" className="gap-1">
              <BookOpen className="w-3 h-3" /> Overview
            </TabsTrigger>
          )}
          <TabsTrigger value="documents" className="gap-1">
            <FileText className="w-3 h-3" /> Documents (
            {person.documents?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-1">
            <Network className="w-3 h-3" /> Connections (
            {person.connections?.length || 0})
          </TabsTrigger>
          {hasTimeline && (
            <TabsTrigger value="timeline" className="gap-1">
              <Clock className="w-3 h-3" /> Timeline (
              {person.timelineEvents!.length})
            </TabsTrigger>
          )}
        </TabsList>

        {/* Overview Tab */}
        {hasOverview && (
          <TabsContent value="overview" className="mt-4 flex flex-col gap-5">
            {/* Summary */}
            {profileSections.find((s) => s.title === "Summary") && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-primary" /> Summary
                  </h2>
                  <div className="flex flex-col gap-2">
                    {profileSections
                      .find((s) => s.title === "Summary")!
                      .content.split("\n")
                      .filter((line) => line.trim())
                      .map((paragraph, i) => (
                        <p
                          key={i}
                          className="text-sm leading-relaxed pl-3 border-l-2 border-primary/20"
                        >
                          {paragraph}
                        </p>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Background */}
            {profileSections.find((s) => s.title === "Background") && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <Briefcase className="w-3.5 h-3.5 text-primary" />{" "}
                    Background
                  </h2>
                  <div className="flex flex-col gap-2">
                    {profileSections
                      .find((s) => s.title === "Background")!
                      .content.split("\n")
                      .filter((line) => line.trim())
                      .map((paragraph, i) => (
                        <p
                          key={i}
                          className="text-sm leading-relaxed pl-3 border-l-2 border-primary/20"
                        >
                          {paragraph}
                        </p>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Key Facts */}
            {person.aiMentions && person.aiMentions.keyFacts.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Key Facts
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {person.aiMentions.keyFacts.slice(0, 20).map((fact, i) => (
                      <li key={i} className="text-sm flex items-start gap-2.5">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-4">
          {person.documents && person.documents.length > 0 ? (
            <div className="flex flex-col gap-2">
              {person.documents.map((doc) => {
                const isVideo = isVideoDocument(doc);
                const Wrapper = isVideo ? "div" : Link;
                const wrapperProps = isVideo
                  ? { onClick: () => videoPlayer.open(doc) }
                  : { href: `/documents/${doc.id}` };
                return (
                  <Wrapper key={doc.id} {...(wrapperProps as any)}>
                    <Card className="hover-elevate cursor-pointer" data-testid={`card-doc-${doc.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
                            {doc.documentType === "court filing" ? (
                              <Scale className="w-4 h-4 text-muted-foreground" />
                            ) : doc.documentType === "fbi report" ? (
                              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                            ) : doc.documentType === "email" ? (
                              <Mail className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <FileText className="w-4 h-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <span className="text-sm font-medium">{doc.title}</span>
                            {doc.description && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
                            )}
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <Badge variant="outline" className="text-[10px]">{doc.documentType}</Badge>
                              {doc.dataSet && (
                                <span className="text-[10px] text-muted-foreground">Data Set {doc.dataSet}</span>
                              )}
                              {doc.isRedacted && (
                                <Badge variant="secondary" className="text-[10px] bg-destructive/10 text-destructive">
                                  Redacted
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Wrapper>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <FileText className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No associated documents found.
              </p>
            </div>
          )}
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="mt-4">
          {person.connections && person.connections.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex justify-end">
                <ExportButton
                  endpoint={`/api/export/persons`}
                  filename={`${person.name.toLowerCase().replace(/\s+/g, "-")}-connections`}
                  label="Export"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {person.connections.map((conn) => {
                  const connPerson = conn.person;
                  const connInitials = connPerson.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2);

                  return (
                    <Link key={conn.id} href={`/people/${connPerson.id}`}>
                      <Card
                        className="hover-elevate cursor-pointer h-full"
                        data-testid={`card-connection-${conn.id}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Avatar className="w-10 h-10 border border-border shrink-0">
                              {connPerson.imageUrl && (
                                <AvatarImage
                                  src={connPerson.imageUrl}
                                  alt={connPerson.name}
                                />
                              )}
                              <AvatarFallback className="text-xs font-medium bg-muted">
                                {connInitials}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col gap-1 min-w-0 flex-1">
                              <PersonHoverCard person={connPerson}>
                                <span className="text-sm font-semibold hover:underline">
                                  {connPerson.name}
                                </span>
                              </PersonHoverCard>
                              <Badge
                                variant="outline"
                                className="text-[10px] w-fit"
                              >
                                {conn.connectionType}
                              </Badge>
                              {conn.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {conn.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Network className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No mapped connections yet.
              </p>
            </div>
          )}
        </TabsContent>

        {/* Timeline Tab */}
        {hasTimeline && (
          <TabsContent value="timeline" className="mt-4">
            <div className="flex flex-col gap-3">
              {person.timelineEvents!.map((event: any) => (
                <Card key={event.id} data-testid={`card-event-${event.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center gap-1 shrink-0 w-20">
                        <span className="text-xs font-mono text-muted-foreground">
                          {event.date}
                        </span>
                        <div className="flex items-center gap-0.5">
                          {Array.from({
                            length: Math.min(event.significance, 5),
                          }).map((_: unknown, i: number) => (
                            <div
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-primary"
                            />
                          ))}
                          {Array.from({
                            length: Math.max(0, 5 - event.significance),
                          }).map((_: unknown, i: number) => (
                            <div
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-muted"
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <span className="text-sm font-medium">
                          {event.title}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {event.description}
                        </p>
                        <Badge
                          variant="outline"
                          className="text-[10px] w-fit mt-1"
                        >
                          {event.category}
                        </Badge>

                        {/* Linked people */}
                        {event.persons?.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-1">
                            <Users className="w-3 h-3 text-muted-foreground shrink-0" />
                            {event.persons.map(
                              (p: { id: number; name: string }, i: number) => (
                                <Link key={p.id} href={`/people/${p.id}`}>
                                  <span className="text-[11px] text-primary hover:underline cursor-pointer">
                                    {p.name}
                                    {i < event.persons.length - 1 ? "," : ""}
                                  </span>
                                </Link>
                              ),
                            )}
                          </div>
                        )}

                        {/* Linked documents */}
                        {event.documents?.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                            {event.documents.map(
                              (d: { id: number; title: string }, i: number) => (
                                <Link key={d.id} href={`/documents/${d.id}`}>
                                  <span className="text-[11px] text-primary hover:underline cursor-pointer">
                                    {d.title.length > 40
                                      ? d.title.slice(0, 40) + "…"
                                      : d.title}
                                    {i < event.documents.length - 1 ? "," : ""}
                                  </span>
                                </Link>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>

      <VideoPlayerModal doc={videoPlayer.videoDoc} open={videoPlayer.isOpen} onClose={videoPlayer.close} />
    </div>
  );
}
