import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  FileText,
  Clock,
  Search,
  Network,
  // MessageCircle,
  ExternalLink,
  Shield,
} from "lucide-react";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "People", url: "/people", icon: Users },
  { title: "Documents", url: "/documents", icon: FileText },
  { title: "Timeline", url: "/timeline", icon: Clock },
  { title: "Network", url: "/network", icon: Network },
  { title: "Search", url: "/search", icon: Search },
  // { title: "Ask the Archive", url: "/ask-the-archive", icon: MessageCircle },
];

export function AppSidebar() {
  const [location] = useLocation();

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
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      data-testid={`nav-${item.title.toLowerCase()}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
          <p className="leading-relaxed px-1.5">
            All information sourced from publicly released government records.
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
