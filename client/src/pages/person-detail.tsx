import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  FileText,
  Network,
  Users,
  MapPin,
  Briefcase,
  Clock,
  Scale,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { PersonHoverCard } from "@/components/person-hover-card";
import { ExportButton } from "@/components/export-button";
import type { Person, Document, Connection } from "@shared/schema";

interface PersonDetail extends Person {
  documents: Document[];
  connections: (Connection & { person: Person })[];
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

  const { data: person, isLoading } = useQuery<PersonDetail>({
    queryKey: ["/api/persons", params.id],
  });

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
          <Button variant="outline" size="sm" data-testid="button-back-to-people">
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

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <Link href="/people">
        <Button variant="ghost" size="sm" className="gap-1 -ml-2" data-testid="button-back">
          <ArrowLeft className="w-4 h-4" /> People Directory
        </Button>
      </Link>

      <div className="flex flex-col sm:flex-row items-start gap-4">
        <Avatar className="w-20 h-20 border-2 border-border shrink-0">
          <AvatarFallback className="text-2xl font-bold bg-muted">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-person-name">{person.name}</h1>
              {person.aliases && person.aliases.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Also known as: {person.aliases.join(", ")}
                </p>
              )}
            </div>
            <Badge variant="secondary" className={`${categoryColors[person.category] || ""}`}>
              {person.category}
            </Badge>
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
              <Network className="w-3 h-3" /> {person.connectionCount} connections
            </span>
          </div>

          <p className="text-sm text-muted-foreground mt-1">{person.description}</p>
        </div>
      </div>

      <Tabs defaultValue="documents" className="w-full">
        <TabsList data-testid="tabs-person-detail">
          <TabsTrigger value="documents" className="gap-1">
            <FileText className="w-3 h-3" /> Documents ({person.documents?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-1">
            <Network className="w-3 h-3" /> Connections ({person.connections?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-4">
          {person.documents && person.documents.length > 0 ? (
            <div className="flex flex-col gap-2">
              {person.documents.map((doc) => (
                <Link key={doc.id} href={`/documents/${doc.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`card-doc-${doc.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted shrink-0">
                          {doc.documentType === "court filing" ? (
                            <Scale className="w-4 h-4 text-muted-foreground" />
                          ) : doc.documentType === "fbi report" ? (
                            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
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
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <FileText className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No associated documents found.</p>
            </div>
          )}
        </TabsContent>

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
                    <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-connection-${conn.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Avatar className="w-10 h-10 border border-border shrink-0">
                            <AvatarFallback className="text-xs font-medium bg-muted">{connInitials}</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <PersonHoverCard person={connPerson}>
                              <span className="text-sm font-semibold hover:underline">{connPerson.name}</span>
                            </PersonHoverCard>
                            <Badge variant="outline" className="text-[10px] w-fit">{conn.connectionType}</Badge>
                            {conn.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{conn.description}</p>
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
              <p className="text-sm text-muted-foreground">No mapped connections yet.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
