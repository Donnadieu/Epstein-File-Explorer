import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Search as SearchIcon,
  FileText,
  Users,
  Clock,
  Scale,
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  History,
  X,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import type { Person, Document, TimelineEvent } from "@shared/schema";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useSearchHistory } from "@/hooks/use-search-history";
import { SavedSearches } from "@/components/saved-searches";

interface SearchResults {
  persons: Person[];
  documents: Document[];
  events: TimelineEvent[];
}

interface PageSearchResult {
  documentId: number;
  title: string;
  documentType: string;
  dataSet: string | null;
  pageNumber: number;
  headline: string;
}

interface PageSearchResponse {
  results: PageSearchResult[];
  total: number;
  page: number;
  totalPages: number;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const prevQueryRef = useRef("");
  const { searchBookmarks, isBookmarked, toggleBookmark, deleteBookmark } = useBookmarks();
  const { history, addSearch, clearHistory } = useSearchHistory();

  // Debounce search queries to avoid hammering the API on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setFtPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const [ftPage, setFtPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery<SearchResults>({
    queryKey: ["/api/search?q=" + encodeURIComponent(debouncedQuery)],
    enabled: debouncedQuery.length >= 2,
  });

  const { data: pageData } = useQuery<PageSearchResponse>({
    queryKey: [`/api/search/pages?q=${encodeURIComponent(debouncedQuery)}&page=${ftPage}&limit=20`],
    enabled: debouncedQuery.length >= 2,
  });

  // Record search to history when results arrive
  useEffect(() => {
    if (data && query.length >= 2 && query !== prevQueryRef.current) {
      addSearch(query);
      prevQueryRef.current = query;
    }
  }, [data, query, addSearch]);

  const totalResults =
    (data?.persons?.length || 0) + (data?.documents?.length || 0) + (data?.events?.length || 0);

  const groupedFullTextResults = useMemo(() => {
    if (!pageData?.results) return [];
    const groups = new Map<number, {
      documentId: number;
      title: string;
      documentType: string;
      dataSet: string | null;
      pages: { pageNumber: number; headline: string }[];
    }>();
    for (const result of pageData.results) {
      let group = groups.get(result.documentId);
      if (!group) {
        group = {
          documentId: result.documentId,
          title: result.title,
          documentType: result.documentType,
          dataSet: result.dataSet,
          pages: [],
        };
        groups.set(result.documentId, group);
      }
      group.pages.push({ pageNumber: result.pageNumber, headline: result.headline });
    }
    return Array.from(groups.values());
  }, [pageData?.results]);

  const handleSavedSearchSelect = useCallback((searchQuery: string) => {
    setQuery(searchQuery);
  }, []);

  const handleHistorySelect = useCallback((term: string) => {
    setQuery(term);
  }, []);

  const searchIsBookmarked = isBookmarked("search", undefined, query);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-search-title">
          <SearchIcon className="w-6 h-6 text-primary" />
          Search Everything
        </h1>
        <p className="text-sm text-muted-foreground">
          Search across all people, documents, and events in the Epstein files database.
        </p>
      </div>

      {/* Saved Searches */}
      <SavedSearches
        savedSearches={searchBookmarks}
        onSelect={handleSavedSearchSelect}
        onRemove={deleteBookmark}
      />

      {/* Search Input with Bookmark Toggle */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 w-full max-w-2xl">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search names, documents, events, keywords..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 h-11 text-base"
              data-testid="input-global-search"
              autoFocus
            />
          </div>
          {query.length >= 2 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleBookmark("search", undefined, query, query)}
              className={searchIsBookmarked ? "text-primary" : "text-muted-foreground"}
              data-testid="button-bookmark-search"
              aria-label={searchIsBookmarked ? "Remove search bookmark" : "Bookmark this search"}
            >
              {searchIsBookmarked ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
            </Button>
          )}
        </div>

        {/* Search History */}
        {history.length > 0 && query.length < 2 && (
          <div className="flex items-center gap-1.5 max-w-2xl" data-testid="search-history-section">
            <History className="w-3 h-3 text-muted-foreground/50 shrink-0" />
            {history.map((term) => (
              <Badge
                key={term}
                variant="outline"
                className="cursor-pointer text-[11px] text-muted-foreground/70 hover:text-foreground"
                onClick={() => handleHistorySelect(term)}
                data-testid={`history-${term.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {term}
              </Badge>
            ))}
            <button
              onClick={clearHistory}
              className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground ml-1"
              aria-label="Clear search history"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {query.length < 2 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <SearchIcon className="w-12 h-12 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Enter at least 2 characters to search.</p>
          <div className="flex flex-col gap-2 items-center">
            <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Popular searches
            </span>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {["Clinton", "flight log", "Maxwell", "deposition", "FBI", "island", "Epstein"].map((term) => (
                <Badge
                  key={term}
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => setQuery(term)}
                  data-testid={`badge-suggestion-${term.toLowerCase().replace(" ", "-")}`}
                >
                  {term}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-center mt-1">
              {["witness testimony", "financial records", "travel records"].map((term) => (
                <Badge
                  key={term}
                  variant="outline"
                  className="cursor-pointer text-muted-foreground/60"
                  onClick={() => setQuery(term)}
                  data-testid={`badge-suggestion-${term.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {term}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ) : isLoading || isFetching ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {totalResults} results for "{query}"
          </p>
          <Tabs defaultValue="all" className="w-full">
            <TabsList data-testid="tabs-search-results">
              <TabsTrigger value="all">All ({totalResults})</TabsTrigger>
              <TabsTrigger value="fulltext" className="gap-1">
                <BookOpen className="w-3 h-3" /> Full Text ({pageData?.total ?? 0})
              </TabsTrigger>
              <TabsTrigger value="people" className="gap-1">
                <Users className="w-3 h-3" /> People ({data?.persons?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-1">
                <FileText className="w-3 h-3" /> Documents ({data?.documents?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="events" className="gap-1">
                <Clock className="w-3 h-3" /> Events ({data?.events?.length || 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4 flex flex-col gap-4">
              {data?.persons && data.persons.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" /> People
                  </h3>
                  {data.persons.slice(0, 5).map((person) => (
                    <PersonResult key={person.id} person={person} isBookmarked={isBookmarked} toggleBookmark={toggleBookmark} />
                  ))}
                </div>
              )}
              {data?.documents && data.documents.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" /> Documents
                  </h3>
                  {data.documents.slice(0, 5).map((doc) => (
                    <DocumentResult key={doc.id} doc={doc} isBookmarked={isBookmarked} toggleBookmark={toggleBookmark} />
                  ))}
                </div>
              )}
              {data?.events && data.events.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" /> Events
                  </h3>
                  {data.events.slice(0, 5).map((event) => (
                    <EventResult key={event.id} event={event} />
                  ))}
                </div>
              )}
              {totalResults === 0 && <NoResultsState query={query} />}
            </TabsContent>

            <TabsContent value="people" className="mt-4 flex flex-col gap-2">
              {data?.persons?.map((person) => <PersonResult key={person.id} person={person} isBookmarked={isBookmarked} toggleBookmark={toggleBookmark} />)}
              {(!data?.persons || data.persons.length === 0) && (
                <EmptyState type="people" query={query} />
              )}
            </TabsContent>

            <TabsContent value="documents" className="mt-4 flex flex-col gap-2">
              {data?.documents?.map((doc) => <DocumentResult key={doc.id} doc={doc} isBookmarked={isBookmarked} toggleBookmark={toggleBookmark} />)}
              {(!data?.documents || data.documents.length === 0) && (
                <EmptyState type="documents" query={query} />
              )}
            </TabsContent>

            <TabsContent value="events" className="mt-4 flex flex-col gap-2">
              {data?.events?.map((event) => <EventResult key={event.id} event={event} />)}
              {(!data?.events || data.events.length === 0) && (
                <EmptyState type="events" query={query} />
              )}
            </TabsContent>

            <TabsContent value="fulltext" className="mt-4 flex flex-col gap-2">
              {groupedFullTextResults.length > 0 ? (
                <Accordion type="multiple" defaultValue={groupedFullTextResults.map((g) => String(g.documentId))} className="w-full">
                  {groupedFullTextResults.map((group) => (
                    <AccordionItem key={group.documentId} value={String(group.documentId)}>
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex items-center gap-2 text-left">
                          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium">{group.title}</span>
                          <Badge variant="outline" className="text-[10px]">{group.documentType}</Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {group.pages.length} {group.pages.length === 1 ? "match" : "matches"}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2">
                        <div className="flex flex-col gap-1.5 pl-6">
                          {group.pages.map((page) => (
                            <Link
                              key={`${group.documentId}-${page.pageNumber}`}
                              href={`/documents/${group.documentId}?page=${page.pageNumber}`}
                            >
                              <Card className="hover-elevate cursor-pointer">
                                <CardContent className="p-2.5">
                                  <div className="flex items-start gap-2">
                                    <Badge variant="secondary" className="text-[10px] shrink-0 mt-0.5">
                                      Page {page.pageNumber}
                                    </Badge>
                                    <p
                                      className="text-xs text-muted-foreground leading-relaxed [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-900/50 [&_mark]:px-0.5 [&_mark]:rounded-sm"
                                      dangerouslySetInnerHTML={{ __html: page.headline }}
                                    />
                                  </div>
                                </CardContent>
                              </Card>
                            </Link>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                <EmptyState type="full text" query={query} />
              )}
              {pageData && pageData.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFtPage((p) => Math.max(1, p - 1))}
                    disabled={ftPage <= 1}
                    className="gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {pageData.page} of {pageData.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFtPage((p) => Math.min(pageData.totalPages, p + 1))}
                    disabled={ftPage >= pageData.totalPages}
                    className="gap-1"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function PersonResult({ person, isBookmarked, toggleBookmark }: {
  person: Person;
  isBookmarked: (entityType: string, entityId?: number, searchQuery?: string) => any;
  toggleBookmark: (entityType: "person" | "document" | "search", entityId?: number, searchQuery?: string, label?: string) => void;
}) {
  const bookmarked = isBookmarked("person", person.id);
  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <Card className="hover-elevate cursor-pointer group" data-testid={`result-person-${person.id}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <Link href={`/people/${person.id}`} className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar className="w-9 h-9 border border-border shrink-0">
              {person.imageUrl && <AvatarImage src={person.imageUrl} alt={person.name} />}
              <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-sm font-semibold">{person.name}</span>
              <span className="text-xs text-muted-foreground truncate">{person.occupation || person.role}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="outline" className="text-[10px]">{person.category}</Badge>
                <span className="text-[10px] text-muted-foreground">{person.documentCount} docs</span>
              </div>
            </div>
          </Link>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleBookmark("person", person.id, undefined, person.name);
            }}
            className={`shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ${
              bookmarked ? "opacity-100 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label={bookmarked ? `Remove bookmark: ${person.name}` : `Bookmark ${person.name}`}
            data-testid={`bookmark-person-${person.id}`}
          >
            {bookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentResult({ doc, isBookmarked, toggleBookmark }: {
  doc: Document;
  isBookmarked: (entityType: string, entityId?: number, searchQuery?: string) => any;
  toggleBookmark: (entityType: "person" | "document" | "search", entityId?: number, searchQuery?: string, label?: string) => void;
}) {
  const bookmarked = isBookmarked("document", doc.id);
  const typeIcons: Record<string, any> = {
    "court filing": Scale,
    "fbi report": AlertTriangle,
  };
  const Icon = typeIcons[doc.documentType] || FileText;

  return (
    <Card className="hover-elevate cursor-pointer group" data-testid={`result-document-${doc.id}`}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Link href={`/documents/${doc.id}`} className="flex items-start gap-3 min-w-0 flex-1">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
              <Icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-sm font-medium">{doc.title}</span>
              {doc.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">{doc.description}</p>
              )}
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="outline" className="text-[10px]">{doc.documentType}</Badge>
                {doc.isRedacted && (
                  <Badge variant="secondary" className="text-[10px] bg-destructive/10 text-destructive">
                    Redacted
                  </Badge>
                )}
              </div>
            </div>
          </Link>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleBookmark("document", doc.id, undefined, doc.title);
            }}
            className={`shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ${
              bookmarked ? "opacity-100 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label={bookmarked ? `Remove bookmark: ${doc.title}` : `Bookmark ${doc.title}`}
            data-testid={`bookmark-document-${doc.id}`}
          >
            {bookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function EventResult({ event }: { event: TimelineEvent }) {
  return (
    <Link href="/timeline">
      <Card className="hover-elevate cursor-pointer" data-testid={`result-event-${event.id}`}>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
              <Clock className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-xs font-mono text-muted-foreground">{event.date}</span>
              <span className="text-sm font-medium">{event.title}</span>
              <p className="text-xs text-muted-foreground line-clamp-1">{event.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PageResult({ result }: { result: PageSearchResult }) {
  return (
    <Link href={`/documents/${result.documentId}?page=${result.pageNumber}`}>
      <Card className="hover-elevate cursor-pointer" data-testid={`result-page-${result.documentId}-${result.pageNumber}`}>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <span className="text-sm font-medium">{result.title}</span>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{result.documentType}</Badge>
                <Badge variant="secondary" className="text-[10px]">Page {result.pageNumber}</Badge>
                {result.dataSet && (
                  <span className="text-[10px] text-muted-foreground">Set {result.dataSet}</span>
                )}
              </div>
              <p
                className="text-xs text-muted-foreground leading-relaxed [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-900/50 [&_mark]:px-0.5 [&_mark]:rounded-sm"
                dangerouslySetInnerHTML={{ __html: result.headline }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function NoResultsState({ query }: { query: string }) {
  const suggestions = [
    "Try different keywords or check spelling",
    "Search for a person's name, document title, or event",
    "Use broader terms like 'flight' instead of 'flight log 2005'",
  ];

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <SearchIcon className="w-10 h-10 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No results found for "{query}".</p>
      <ul className="text-xs text-muted-foreground/60 space-y-1">
        {suggestions.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ type, query }: { type: string; query: string }) {
  const hints: Record<string, string> = {
    people: "Try searching by name, occupation, or role (e.g., 'attorney', 'pilot')",
    documents: "Try searching by title, type, or content (e.g., 'deposition', 'court filing')",
    events: "Try searching by date, category, or description (e.g., '2005', 'arrest')",
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <SearchIcon className="w-8 h-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">
        No {type} found for "{query}".
      </p>
      {hints[type] && (
        <p className="text-xs text-muted-foreground/50">{hints[type]}</p>
      )}
    </div>
  );
}
