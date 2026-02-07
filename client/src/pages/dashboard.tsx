import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users,
  FileText,
  Network,
  Clock,
  ArrowRight,
  Search,
  TrendingUp,
  AlertTriangle,
  Scale,
} from "lucide-react";
import { PersonHoverCard } from "@/components/person-hover-card";
import { ExportButton } from "@/components/export-button";
import type { Person, Document, TimelineEvent } from "@shared/schema";

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  href,
}: {
  icon: any;
  label: string;
  value: string | number;
  sublabel: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover-elevate cursor-pointer" data-testid={`card-stat-${label.toLowerCase()}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
              <span className="text-2xl font-bold tracking-tight" data-testid={`text-stat-${label.toLowerCase()}`}>{value}</span>
              <span className="text-xs text-muted-foreground">{sublabel}</span>
            </div>
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
              <Icon className="w-5 h-5 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PersonCard({ person }: { person: Person }) {
  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const categoryColors: Record<string, string> = {
    "key figure": "bg-destructive/10 text-destructive",
    associate: "bg-primary/10 text-primary",
    victim: "bg-chart-4/10 text-chart-4",
    witness: "bg-chart-3/10 text-chart-3",
    legal: "bg-chart-2/10 text-chart-2",
    political: "bg-chart-5/10 text-chart-5",
  };

  return (
    <Link href={`/people/${person.id}`}>
      <Card className="hover-elevate cursor-pointer h-full">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Avatar className="w-10 h-10 border border-border">
              <AvatarFallback className="text-xs font-medium bg-muted">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <PersonHoverCard person={person}>
                <span className="text-sm font-semibold truncate hover:underline" data-testid={`text-person-name-${person.id}`}>{person.name}</span>
              </PersonHoverCard>
              <span className="text-xs text-muted-foreground truncate">{person.occupation || person.role}</span>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <Badge variant="secondary" className={`text-[10px] ${categoryColors[person.category] || ""}`}>
                  {person.category}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{person.documentCount} docs</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function RecentDocCard({ doc }: { doc: Document }) {
  const typeIcons: Record<string, any> = {
    "flight log": Clock,
    "court filing": Scale,
    email: FileText,
    photograph: FileText,
    "fbi report": AlertTriangle,
  };
  const Icon = typeIcons[doc.documentType] || FileText;

  return (
    <Link href={`/documents/${doc.id}`}>
      <div className="flex items-start gap-3 p-3 rounded-md hover-elevate cursor-pointer">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-sm font-medium truncate" data-testid={`text-doc-title-${doc.id}`}>{doc.title}</span>
          <span className="text-xs text-muted-foreground truncate">{doc.description}</span>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-[10px]">{doc.documentType}</Badge>
            {doc.isRedacted && (
              <Badge variant="secondary" className="text-[10px] bg-destructive/10 text-destructive">
                Redacted
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<{
    personCount: number;
    documentCount: number;
    connectionCount: number;
    eventCount: number;
  }>({
    queryKey: ["/api/stats"],
  });

  const { data: allPeople, isLoading: peopleLoading } = useQuery<Person[]>({
    queryKey: ["/api/persons"],
  });

  const { data: allDocs, isLoading: docsLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const { data: allEvents, isLoading: eventsLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["/api/timeline"],
  });

  const featuredPeople = allPeople?.slice(0, 6);
  const recentDocs = allDocs?.slice(0, 5);
  const events = allEvents?.filter(e => e.significance >= 3).slice(-4);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">
          Epstein Files Explorer
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Explore millions of pages of publicly released documents from the Department of Justice, court records, and congressional disclosures related to the Jeffrey Epstein case.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard icon={Users} label="People" value={stats?.personCount || 0} sublabel="Named individuals" href="/people" />
            <StatCard icon={FileText} label="Documents" value={stats?.documentCount || 0} sublabel="Public records" href="/documents" />
            <StatCard icon={Network} label="Connections" value={stats?.connectionCount || 0} sublabel="Mapped relationships" href="/network" />
            <StatCard icon={Clock} label="Events" value={stats?.eventCount || 0} sublabel="Timeline entries" href="/timeline" />
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Link href="/search">
          <Button variant="outline" className="gap-2" data-testid="button-global-search">
            <Search className="w-4 h-4" />
            Search all files...
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Key Individuals
            </h2>
            <div className="flex items-center gap-2">
              <ExportButton endpoint="/api/export/persons" filename="persons" label="Export" />
              <Link href="/people">
                <Button variant="ghost" size="sm" className="gap-1 text-xs" data-testid="button-view-all-people">
                  View all <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </div>
          {peopleLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {featuredPeople?.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Recent Documents
            </h2>
            <Link href="/documents">
              <Button variant="ghost" size="sm" className="gap-1 text-xs" data-testid="button-view-all-docs">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <Card>
            <CardContent className="p-2">
              {docsLoading ? (
                <div className="flex flex-col gap-2 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col">
                  {recentDocs?.map((doc) => (
                    <RecentDocCard key={doc.id} doc={doc} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Key Events
            </h2>
            <Link href="/timeline">
              <Button variant="ghost" size="sm" className="gap-1 text-xs" data-testid="button-view-timeline">
                Full timeline <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <Card>
            <CardContent className="p-4">
              {eventsLoading ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {events?.map((event) => (
                    <div key={event.id} className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-xs text-muted-foreground font-mono">{event.date}</span>
                        <span className="text-sm font-medium">{event.title}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Disclaimer</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This tool aggregates publicly available information from government releases. Being named in a document does not imply wrongdoing. Many individuals listed were witnesses, victims, or mentioned in other non-incriminating contexts. All data is sourced from DOJ public records.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
