import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type {
  AIAnalysisListResponse,
  AIAnalysisDocument,
  AIAnalysisAggregate,
  AIAnalysisPerson,
  AIAnalysisConnection,
  AIAnalysisEvent,
} from "@shared/schema";
import {
  Brain,
  CheckCircle,
  Clock,
  AlertTriangle,
  DollarSign,
  Users,
  MapPin,
  Link2,
  FileText,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

const categoryColors: Record<string, string> = {
  "key figure": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  associate: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  victim: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  witness: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  legal: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  political: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  "law enforcement": "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
  staff: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export default function AIInsightsPage() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { data: pipelineStats, isLoading: statsLoading } = useQuery<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
  }>({ queryKey: ["/api/pipeline/stats"] });

  const { data: budget, isLoading: budgetLoading } = useQuery<{
    totalCostCents: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    byModel: Record<string, number>;
  }>({ queryKey: ["/api/budget"] });

  const { data: analysisList, isLoading: listLoading } = useQuery<AIAnalysisListResponse>({
    queryKey: ["/api/ai-analyses"],
  });

  const { data: selectedAnalysis, isLoading: detailLoading } = useQuery<AIAnalysisDocument>({
    queryKey: ["/api/ai-analyses", selectedFile],
    enabled: !!selectedFile,
  });

  const { data: aggregate, isLoading: aggregateLoading } = useQuery<AIAnalysisAggregate>({
    queryKey: ["/api/ai-analyses/aggregate"],
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-ai-insights-title">
          <Brain className="w-6 h-6 text-primary" />
          AI Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          AI-extracted insights, entities, and connections from analyzed documents.
        </p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList data-testid="tabs-ai-insights">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="aggregate">Aggregate</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 flex flex-col gap-4">
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
                <Card data-testid="card-stat-analyzed">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Analyzed</span>
                        <span className="text-2xl font-bold tracking-tight">{pipelineStats?.completed || 0}</span>
                      </div>
                      <div className="flex items-center justify-center w-10 h-10 rounded-md bg-green-100 dark:bg-green-900/30">
                        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card data-testid="card-stat-pending">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Pending</span>
                        <span className="text-2xl font-bold tracking-tight">
                          {(pipelineStats?.pending || 0) + (pipelineStats?.running || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-center w-10 h-10 rounded-md bg-yellow-100 dark:bg-yellow-900/30">
                        <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card data-testid="card-stat-failed">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Failed</span>
                        <span className="text-2xl font-bold tracking-tight">{pipelineStats?.failed || 0}</span>
                      </div>
                      <div className="flex items-center justify-center w-10 h-10 rounded-md bg-red-100 dark:bg-red-900/30">
                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card data-testid="card-stat-cost">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Cost</span>
                        <span className="text-2xl font-bold tracking-tight">
                          ${((budget?.totalCostCents || 0) / 100).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
                        <DollarSign className="w-5 h-5 text-primary" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <Card data-testid="card-budget-details">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Budget Details</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {budgetLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-56" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Input Tokens</span>
                    <span className="font-mono">{(budget?.totalInputTokens || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Output Tokens</span>
                    <span className="font-mono">{(budget?.totalOutputTokens || 0).toLocaleString()}</span>
                  </div>
                  {budget?.byModel && Object.keys(budget.byModel).length > 0 && (
                    <div className="flex flex-col gap-1 mt-2">
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Cost per Model</span>
                      {Object.entries(budget.byModel).map(([model, costCents]) => (
                        <div key={model} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground font-mono text-xs">{model}</span>
                          <span className="font-mono">${(costCents / 100).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-4">
          {listLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
              <div className="lg:col-span-2">
                <Skeleton className="h-64 w-full" />
              </div>
            </div>
          ) : !analysisList?.analyses || analysisList.analyses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Brain className="w-12 h-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No documents have been analyzed yet.</p>
              <p className="text-xs text-muted-foreground/60">
                Run the AI pipeline to start extracting insights from documents.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1">
                <ScrollArea className="h-[600px]">
                  <div className="flex flex-col gap-1 pr-4">
                    {analysisList.analyses.map((analysis) => (
                      <div
                        key={analysis.fileName}
                        className={`flex flex-col gap-1 p-3 rounded-md cursor-pointer transition-colors ${
                          selectedFile === analysis.fileName ? "bg-accent" : "hover:bg-muted"
                        }`}
                        onClick={() => setSelectedFile(analysis.fileName)}
                        data-testid={`analysis-item-${analysis.fileName}`}
                      >
                        <span className="text-sm font-medium truncate">{analysis.fileName}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{analysis.documentType}</Badge>
                          <span className="text-[10px] text-muted-foreground">
                            <Users className="w-3 h-3 inline mr-0.5" />
                            {analysis.personCount}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {analysis.analyzedAt ? new Date(analysis.analyzedAt).toLocaleDateString() : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="lg:col-span-2">
                {!selectedFile ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <FileText className="w-10 h-10 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">
                      Select a document to view its AI-extracted insights.
                    </p>
                  </div>
                ) : detailLoading ? (
                  <div className="flex flex-col gap-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-40 w-full" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : selectedAnalysis ? (
                  <DocumentDetail analysis={selectedAnalysis} />
                ) : null}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Aggregate Tab */}
        <TabsContent value="aggregate" className="mt-4">
          {aggregateLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-8 w-48" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            </div>
          ) : !aggregate || aggregate.totalDocuments === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <BarChart3 className="w-12 h-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No aggregate data available yet.</p>
              <p className="text-xs text-muted-foreground/60">
                Analyze documents to see cross-document insights.
              </p>
            </div>
          ) : (
            <AggregateView aggregate={aggregate} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DocumentDetail({ analysis }: { analysis: AIAnalysisDocument }) {
  return (
    <div className="flex flex-col gap-4" data-testid="document-detail-panel">
      {/* Summary */}
      {analysis.summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-sm text-muted-foreground leading-relaxed">{analysis.summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Persons */}
      {analysis.persons && analysis.persons.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Persons ({analysis.persons.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {analysis.persons.map((person: AIAnalysisPerson, i: number) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{person.name}</span>
                    {person.role && (
                      <span className="text-xs text-muted-foreground">{person.role}</span>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge className={`text-[10px] ${categoryColors[person.category?.toLowerCase() ?? ""] || categoryColors.other}`}>
                        {person.category}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {person.mentionCount} mentions
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Connections */}
      {analysis.connections && analysis.connections.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            Connections ({analysis.connections.length})
          </h3>
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-col gap-2">
                {analysis.connections.map((conn: AIAnalysisConnection, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{conn.person1}</span>
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      <span className="font-medium">{conn.person2}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{conn.relationshipType}</Badge>
                      <span className="text-muted-foreground text-xs">
                        {Array.from({ length: conn.strength || 0 }).map((_, j) => (
                          <span key={j}>●</span>
                        ))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Events */}
      {analysis.events && analysis.events.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Events ({analysis.events.length})
          </h3>
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-col gap-3">
                {[...analysis.events]
                  .sort((a: AIAnalysisEvent, b: AIAnalysisEvent) => (a.date || "").localeCompare(b.date || ""))
                  .map((event: AIAnalysisEvent, i: number) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        {event.date && (
                          <span className="text-xs text-muted-foreground font-mono">{event.date}</span>
                        )}
                        <span className="text-sm font-medium">{event.title}</span>
                        {event.description && (
                          <p className="text-xs text-muted-foreground">{event.description}</p>
                        )}
                        {(event.significance ?? 0) > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            Significance: {Array.from({ length: event.significance! }).map((_, j) => (
                              <span key={j}>●</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Locations */}
      {analysis.locations && analysis.locations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Locations ({analysis.locations.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {analysis.locations.map((location: string, i: number) => (
              <Badge key={i} variant="secondary">{location}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Key Facts */}
      {analysis.keyFacts && analysis.keyFacts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Key Facts ({analysis.keyFacts.length})
          </h3>
          <Card>
            <CardContent className="p-3">
              <ol className="flex flex-col gap-1.5 list-decimal list-inside">
                {analysis.keyFacts.map((fact: string, i: number) => (
                  <li key={i} className="text-sm text-muted-foreground">{fact}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function AggregateView({ aggregate }: { aggregate: AIAnalysisAggregate }) {
  const topPersons = aggregate.topPersons?.slice(0, 12) || [];
  const locations = aggregate.topLocations || [];
  const connectionTypes = aggregate.connectionTypes || [];
  const documentTypes = aggregate.documentTypes || [];

  return (
    <div className="flex flex-col gap-6" data-testid="aggregate-view">
      {/* Most Mentioned Persons */}
      {topPersons.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Most Mentioned Persons
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topPersons.map((person, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">{person.name}</span>
                    <Badge className={`text-[10px] w-fit ${categoryColors[person.category?.toLowerCase()] || categoryColors.other}`}>
                      {person.category}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {person.mentionCount} mentions · {person.documentCount} documents
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Common Locations */}
      {locations.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Common Locations
          </h3>
          <div className="flex flex-wrap gap-2">
            {locations.map((loc, i) => (
              <Badge key={i} variant="secondary">
                {loc.location} ({loc.documentCount})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Connection Types */}
      {connectionTypes.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            Connection Types
          </h3>
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-col gap-2">
                {connectionTypes.map((ct, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{ct.type}</span>
                    <Badge variant="outline">{ct.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Document Types */}
      {documentTypes.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Document Types
          </h3>
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-col gap-2">
                {documentTypes.map((dt, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{dt.type}</span>
                    <Badge variant="outline">{dt.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
