import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  FileText,
  Clock,
  Search,
  Network,
  Brain,
  ExternalLink,
  Shield,
  Gavel,
  Mail,
  AlertTriangle,
  Scale,
  Plane,
  DollarSign,
  BookOpen,
  Image,
  Video,
} from "lucide-react";

interface SidebarCounts {
  documents: { total: number; byType: Record<string, number> };
  media: { images: number; videos: number };
  persons: number;
  events: number;
  connections: number;
}

function formatCount(n: number | undefined): string {
  if (!n) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}

function NavGroup({ label, items, location }: { label: string; items: NavItem[]; location: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = isNavActive(item.url, location);
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Link href={item.url}>
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.count != null && item.count > 0 && (
                  <SidebarMenuBadge>{formatCount(item.count)}</SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function isNavActive(itemUrl: string, currentLocation: string): boolean {
  const [itemPath, itemSearch] = itemUrl.split("?");
  const currentPath = currentLocation.split("?")[0];
  const currentSearch = currentLocation.includes("?") ? currentLocation.split("?")[1] : "";

  // Exact match for root
  if (itemPath === "/" && currentPath === "/") return !currentSearch;

  // For items with query params, match both path and search params
  if (itemSearch) {
    if (currentPath !== itemPath) return false;
    const itemParams = new URLSearchParams(itemSearch);
    const currentParams = new URLSearchParams(currentSearch);
    let allMatch = true;
    itemParams.forEach((value, key) => {
      if (currentParams.get(key) !== value) allMatch = false;
    });
    if (!allMatch) return false;
    return true;
  }

  // Standard prefix match for non-root items
  return currentPath === itemPath || currentPath.startsWith(itemPath + "/");
}

export function AppSidebar() {
  const [location] = useLocation();
  const fullLocation = location + (typeof window !== "undefined" ? window.location.search : "");

  const { data: counts } = useQuery<SidebarCounts>({
    queryKey: ["/api/sidebar-counts"],
    staleTime: 60_000,
  });

  const byType = counts?.documents.byType ?? {};

  const overviewItems: NavItem[] = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
  ];

  const documentItems: NavItem[] = [
    { title: "All Documents", url: "/documents", icon: FileText, count: counts?.documents.total },
    // { title: "Flight Logs", url: "/documents?type=flight+log", icon: Plane, count: byType["flight log"] },
    // { title: "Emails", url: "/documents?type=email", icon: Mail, count: byType["email"] },
    // TODO: Uncomment as AI backfill populates these categories
    // { title: "Court Filings", url: "/documents?type=court+filing", icon: Gavel, count: byType["court filing"] },
    // { title: "FBI Reports", url: "/documents?type=fbi+report", icon: AlertTriangle, count: byType["fbi report"] },
    // { title: "Depositions", url: "/documents?type=deposition", icon: Scale, count: byType["deposition"] },
    // { title: "Financial Records", url: "/documents?type=financial+record", icon: DollarSign, count: byType["financial record"] },
    // { title: "Grand Jury", url: "/documents?type=grand+jury+transcript", icon: BookOpen, count: byType["grand jury transcript"] },
    // { title: "Correspondence", url: "/documents?type=correspondence", icon: Mail, count: byType["correspondence"] },
  ];

  // TODO: Uncomment when media classification is refined
  // const mediaItems: NavItem[] = [
  //   { title: "Photos", url: "/documents?type=photograph", icon: Image, count: counts?.media.images },
  //   { title: "Videos", url: "/documents?type=video", icon: Video, count: counts?.media.videos },
  // ];

  const investigationItems: NavItem[] = [
    { title: "People", url: "/people", icon: Users, count: counts?.persons },
    { title: "Timeline", url: "/timeline", icon: Clock, count: counts?.events },
    { title: "Network", url: "/network", icon: Network },
    { title: "AI Insights", url: "/ai-insights", icon: Brain },
  ];

  const toolItems: NavItem[] = [
    { title: "Search", url: "/search", icon: Search },
  ];

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2" data-testid="link-home-logo">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
            <Shield className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight" data-testid="text-app-name">Epstein Files</span>
            <span className="text-[10px] text-muted-foreground tracking-wider uppercase">Public Record Explorer</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Overview" items={overviewItems} location={fullLocation} />
        <NavGroup label="Documents" items={documentItems} location={fullLocation} />
        <NavGroup label="Investigation" items={investigationItems} location={fullLocation} />
        <NavGroup label="Tools" items={toolItems} location={fullLocation} />
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex flex-col gap-2 text-[10px] text-muted-foreground">
          <a
            href="https://www.justice.gov/epstein"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover-elevate rounded-md p-1.5"
            data-testid="link-doj-source"
          >
            <ExternalLink className="w-3 h-3" />
            <span>DOJ Epstein Library</span>
          </a>
          <a
            href="https://github.com/yung-megafone/Epstein-Files"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover-elevate rounded-md p-1.5"
            data-testid="link-community-archive"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Community Archive</span>
          </a>
          <p className="leading-relaxed px-1.5">
            Data sourced from publicly released DOJ records. Preserved and distributed by the open-source community.
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
