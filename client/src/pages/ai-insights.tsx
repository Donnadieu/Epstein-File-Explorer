import { useQuery } from "@tanstack/react-query";
import type { AIAnalysisAggregate } from "@shared/schema";
import {
  Brain,
  Users,
  MapPin,
  Link2,
  FileText,
  CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

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

const docTypeChartConfig: ChartConfig = {
  count: { label: "Documents", color: "hsl(var(--primary))" },
};

const connTypeChartConfig: ChartConfig = {
  count: { label: "Connections", color: "hsl(var(--chart-2))" },
};

export default function AIInsightsPage() {
  const { data: aggregate, isLoading, isError } = useQuery<AIAnalysisAggregate>({
    queryKey: ["/api/ai-analyses/aggregate"],
  });

  return (
    <div className="flex flex-col gap-8 p-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-ai-insights-title">
          <Brain className="w-6 h-6 text-primary" />
          AI Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Cross-document patterns extracted by AI from{" "}
          {isLoading ? "..." : (aggregate?.totalDocuments ?? 0).toLocaleString()} analyzed files.
        </p>
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load AI insights data. Please try refreshing the page.
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard icon={FileText} label="Documents Analyzed" value={aggregate?.totalDocuments ?? 0} />
            <StatCard icon={Users} label="Persons Identified" value={aggregate?.totalPersons ?? 0} />
            <StatCard icon={Link2} label="Connections Found" value={aggregate?.totalConnections ?? 0} />
            <StatCard icon={CalendarDays} label="Events Extracted" value={aggregate?.totalEvents ?? 0} />
          </>
        )}
      </div>

      {/* Document Types Bar Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Document Types
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : aggregate?.documentTypes && aggregate.documentTypes.length > 0 ? (
            <ChartContainer config={docTypeChartConfig} className="h-[300px] w-full">
              <BarChart
                data={[...aggregate.documentTypes].sort((a, b) => b.count - a.count)}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
              >
                <CartesianGrid horizontal={false} />
                <YAxis
                  dataKey="type"
                  type="category"
                  width={140}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No document type data available.</p>
          )}
        </CardContent>
      </Card>

      {/* Most Mentioned Persons */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Most Mentioned Persons
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : aggregate?.topPersons && aggregate.topPersons.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {aggregate.topPersons.slice(0, 12).map((person, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">{person.name}</span>
                    <Badge className={`text-[10px] w-fit ${categoryColors[person.category?.toLowerCase()] || categoryColors.other}`}>
                      {person.category}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {person.mentionCount} mentions &middot; {person.documentCount} documents
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">No person data available.</p>
        )}
      </div>

      {/* Connection Types Bar Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            Connection Types
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : aggregate?.connectionTypes && aggregate.connectionTypes.length > 0 ? (
            <ChartContainer config={connTypeChartConfig} className="h-[250px] w-full">
              <BarChart
                data={[...aggregate.connectionTypes].sort((a, b) => b.count - a.count)}
                margin={{ left: 8, right: 16 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis dataKey="type" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No connection type data available.</p>
          )}
        </CardContent>
      </Card>

      {/* Top Locations */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />
          Top Locations
        </h2>
        {isLoading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-24" />
            ))}
          </div>
        ) : aggregate?.topLocations && aggregate.topLocations.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {aggregate.topLocations.map((loc, i) => (
              <Badge key={i} variant="secondary">
                {loc.location} ({loc.documentCount})
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">No location data available.</p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <Card data-testid={`card-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
            <span className="text-2xl font-bold tracking-tight">{value.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
