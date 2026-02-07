import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppBreadcrumbs } from "@/components/breadcrumbs";
import { useKeyboardShortcuts, shortcutsList } from "@/hooks/use-keyboard-shortcuts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/kbd";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import PeoplePage from "@/pages/people";
import PersonDetail from "@/pages/person-detail";
import DocumentsPage from "@/pages/documents";
import DocumentDetailPage from "@/pages/document-detail";
import DocumentComparePage from "@/pages/document-compare";
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
      <Route path="/documents/compare" component={DocumentComparePage} />
      <Route path="/documents/:id" component={DocumentDetailPage} />
      <Route path="/timeline" component={TimelinePage} />
      <Route path="/network" component={NetworkPage} />
      <Route path="/search" component={SearchPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  const [, navigate] = useLocation();
  const { showHelp, closeHelp } = useKeyboardShortcuts(navigate);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <AppBreadcrumbs />
            </div>
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>

      <Dialog open={showHelp} onOpenChange={(open) => !open && closeHelp()}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-keyboard-shortcuts">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogDescription>
              Navigate quickly using these keyboard shortcuts.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 mt-2">
            {shortcutsList.map((s) => (
              <div key={s.keys} className="flex items-center justify-between py-1.5 px-1">
                <span className="text-sm text-muted-foreground">{s.label}</span>
                <Kbd keys={s.keys} />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppShell />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
