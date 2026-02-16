import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bookmark,
  FileText,
  Users,
  Search,
  X,
  Clock,
  Scale,
  AlertTriangle,
} from "lucide-react";
import { useBookmarks } from "@/hooks/use-bookmarks";
import type { Person, Document } from "@shared/schema";

const typeIcons: Record<string, any> = {
  "court filing": Scale,
  "fbi report": AlertTriangle,
  deposition: Scale,
};

const categoryColors: Record<string, string> = {
  "key figure": "bg-destructive/10 text-destructive",
  associate: "bg-primary/10 text-primary",
  victim: "bg-chart-4/10 text-chart-4",
  witness: "bg-chart-3/10 text-chart-3",
  legal: "bg-chart-2/10 text-chart-2",
  political: "bg-chart-5/10 text-chart-5",
};

export default function BookmarksPage() {
  const {
    bookmarks,
    personBookmarks,
    documentBookmarks,
    searchBookmarks,
    deleteBookmark,
    isLoading,
  } = useBookmarks();

  const personIds = personBookmarks.map((b) => b.entityId).filter(Boolean);
  const documentIds = documentBookmarks.map((b) => b.entityId).filter(Boolean);

  const { data: persons } = useQuery<Person[]>({
    queryKey: ["/api/persons"],
    staleTime: 600_000,
    enabled: personIds.length > 0,
  });

  const personMap = new Map(persons?.map((p) => [p.id, p]) ?? []);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bookmark className="w-6 h-6 text-primary" />
          Bookmarks
        </h1>
        <p className="text-sm text-muted-foreground">
          Your saved documents, people, and searches.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading bookmarks...</p>
      ) : bookmarks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Bookmark className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center max-w-md">
            No bookmarks yet. Browse documents and people to start saving items.
          </p>
          <div className="flex gap-2">
            <Link href="/documents">
              <Button variant="outline" size="sm">Browse Documents</Button>
            </Link>
            <Link href="/people">
              <Button variant="outline" size="sm">Browse People</Button>
            </Link>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">
              All ({bookmarks.length})
            </TabsTrigger>
            <TabsTrigger value="documents">
              <FileText className="w-3.5 h-3.5 mr-1" />
              Documents ({documentBookmarks.length})
            </TabsTrigger>
            <TabsTrigger value="people">
              <Users className="w-3.5 h-3.5 mr-1" />
              People ({personBookmarks.length})
            </TabsTrigger>
            <TabsTrigger value="searches">
              <Search className="w-3.5 h-3.5 mr-1" />
              Searches ({searchBookmarks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="flex flex-col gap-3 mt-4">
            {documentBookmarks.length > 0 && (
              <Section title="Documents" icon={FileText} count={documentBookmarks.length}>
                {documentBookmarks.map((b) => (
                  <DocumentBookmarkCard key={b.id} bookmark={b} onRemove={deleteBookmark} />
                ))}
              </Section>
            )}
            {personBookmarks.length > 0 && (
              <Section title="People" icon={Users} count={personBookmarks.length}>
                {personBookmarks.map((b) => {
                  const person = personMap.get(b.entityId!);
                  return (
                    <PersonBookmarkCard key={b.id} bookmark={b} person={person} onRemove={deleteBookmark} />
                  );
                })}
              </Section>
            )}
            {searchBookmarks.length > 0 && (
              <Section title="Searches" icon={Search} count={searchBookmarks.length}>
                <div className="flex flex-wrap gap-2">
                  {searchBookmarks.map((b) => (
                    <SearchBookmarkBadge key={b.id} bookmark={b} onRemove={deleteBookmark} />
                  ))}
                </div>
              </Section>
            )}
          </TabsContent>

          <TabsContent value="documents" className="flex flex-col gap-3 mt-4">
            {documentBookmarks.length === 0 ? (
              <EmptyTab type="documents" />
            ) : (
              documentBookmarks.map((b) => (
                <DocumentBookmarkCard key={b.id} bookmark={b} onRemove={deleteBookmark} />
              ))
            )}
          </TabsContent>

          <TabsContent value="people" className="flex flex-col gap-3 mt-4">
            {personBookmarks.length === 0 ? (
              <EmptyTab type="people" />
            ) : (
              personBookmarks.map((b) => {
                const person = personMap.get(b.entityId!);
                return (
                  <PersonBookmarkCard key={b.id} bookmark={b} person={person} onRemove={deleteBookmark} />
                );
              })
            )}
          </TabsContent>

          <TabsContent value="searches" className="mt-4">
            {searchBookmarks.length === 0 ? (
              <EmptyTab type="searches" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {searchBookmarks.map((b) => (
                  <SearchBookmarkBadge key={b.id} bookmark={b} onRemove={deleteBookmark} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {title} ({count})
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function DocumentBookmarkCard({
  bookmark,
  onRemove,
}: {
  bookmark: { id: number; entityId: number | null; label: string | null; createdAt: string | Date | null };
  onRemove: (id: number) => void;
}) {
  const [, navigate] = useLocation();
  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={() => navigate(`/documents/${bookmark.entityId}`)}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-md bg-muted shrink-0">
          <FileText className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold truncate block">
            {bookmark.label || `Document #${bookmark.entityId}`}
          </span>
          {bookmark.createdAt && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
              <Clock className="w-2.5 h-2.5" /> Saved {new Date(bookmark.createdAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(bookmark.id);
          }}
          aria-label="Remove bookmark"
        >
          <X className="w-4 h-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function PersonBookmarkCard({
  bookmark,
  person,
  onRemove,
}: {
  bookmark: { id: number; entityId: number | null; label: string | null; createdAt: string | Date | null };
  person?: Person;
  onRemove: (id: number) => void;
}) {
  const name = person?.name || bookmark.label || `Person #${bookmark.entityId}`;
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const [, navigate] = useLocation();
  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={() => navigate(`/people/${bookmark.entityId}`)}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <Avatar className="w-10 h-10 border border-border shrink-0">
          <AvatarFallback className="text-sm font-medium bg-muted">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold truncate block">{name}</span>
          <div className="flex items-center gap-2 mt-0.5">
            {person?.category && (
              <Badge variant="secondary" className={`text-[10px] ${categoryColors[person.category] || ""}`}>
                {person.category}
              </Badge>
            )}
            {person?.occupation && (
              <span className="text-[10px] text-muted-foreground truncate">{person.occupation}</span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(bookmark.id);
          }}
          aria-label="Remove bookmark"
        >
          <X className="w-4 h-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function SearchBookmarkBadge({
  bookmark,
  onRemove,
}: {
  bookmark: { id: number; searchQuery: string | null; label: string | null };
  onRemove: (id: number) => void;
}) {
  const [, navigate] = useLocation();
  return (
    <Badge
      variant="secondary"
      className="cursor-pointer group gap-1 pr-1 text-sm py-1"
      onClick={() => navigate(`/search?q=${encodeURIComponent(bookmark.searchQuery || bookmark.label || "")}`)}
    >
      <Search className="w-3 h-3 mr-0.5" />
      <span>{bookmark.label || bookmark.searchQuery}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(bookmark.id);
        }}
        className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={`Remove saved search: ${bookmark.label || bookmark.searchQuery}`}
      >
          <X className="w-3 h-3" />
        </button>
      </Badge>
  );
}

function EmptyTab({ type }: { type: string }) {
  const config: Record<string, { icon: any; text: string; link: string; linkText: string }> = {
    documents: {
      icon: FileText,
      text: "No documents bookmarked yet.",
      link: "/documents",
      linkText: "Browse Documents",
    },
    people: {
      icon: Users,
      text: "No people bookmarked yet.",
      link: "/people",
      linkText: "Browse People",
    },
    searches: {
      icon: Search,
      text: "No searches saved yet.",
      link: "/search",
      linkText: "Go to Search",
    },
  };
  const c = config[type] || config.documents;
  const Icon = c.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Icon className="w-8 h-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{c.text}</p>
      <Link href={c.link}>
        <Button variant="outline" size="sm">{c.linkText}</Button>
      </Link>
    </div>
  );
}
