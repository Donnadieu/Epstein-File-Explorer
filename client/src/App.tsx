import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import PeoplePage from "@/pages/people";
import PersonDetail from "@/pages/person-detail";
import DocumentsPage from "@/pages/documents";
import DocumentDetailPage from "@/pages/document-detail";
import TimelinePage from "@/pages/timeline";
import NetworkPage from "@/pages/network";
import SearchPage from "@/pages/search";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/people" component={PeoplePage} />
      <Route path="/people/:id" component={PersonDetail} />
      <Route path="/documents" component={DocumentsPage} />
      <Route path="/documents/:id" component={DocumentDetailPage} />
      <Route path="/timeline" component={TimelinePage} />
      <Route path="/network" component={NetworkPage} />
      <Route path="/search" component={SearchPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-auto">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
