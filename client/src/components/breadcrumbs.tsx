import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Home } from "lucide-react";
import type { Person, Document } from "@shared/schema";

interface BreadcrumbSegment {
  label: string;
  href?: string;
}

const staticRoutes: Record<string, string> = {
  people: "People",
  documents: "Documents",
  timeline: "Timeline",
  network: "Network",
  search: "Search",
  compare: "Compare",
};

export function AppBreadcrumbs() {
  const [location] = useLocation();

  const segments = location.split("/").filter(Boolean);

  // Detect if we're on a person or document detail page
  const isPersonDetail = segments[0] === "people" && segments[1] && !isNaN(Number(segments[1]));
  const isDocumentDetail = segments[0] === "documents" && segments[1] && segments[1] !== "compare" && !isNaN(Number(segments[1]));
  const isDocumentCompare = segments[0] === "documents" && segments[1] === "compare";

  const personId = isPersonDetail ? segments[1] : undefined;
  const documentId = isDocumentDetail ? segments[1] : undefined;

  const { data: person } = useQuery<Person>({
    queryKey: ["/api/persons", personId],
    enabled: !!personId,
  });

  const { data: document } = useQuery<Document>({
    queryKey: ["/api/documents", documentId],
    enabled: !!documentId,
  });

  if (location === "/") return null;

  const crumbs: BreadcrumbSegment[] = [];

  if (isPersonDetail) {
    crumbs.push({ label: "People", href: "/people" });
    crumbs.push({ label: person?.name || `Person #${personId}` });
  } else if (isDocumentDetail) {
    crumbs.push({ label: "Documents", href: "/documents" });
    crumbs.push({ label: document?.title || `Document #${documentId}` });
  } else if (isDocumentCompare) {
    crumbs.push({ label: "Documents", href: "/documents" });
    crumbs.push({ label: "Compare" });
  } else {
    // Static route like /people, /documents, /timeline, etc.
    const label = staticRoutes[segments[0]] || segments[0];
    crumbs.push({ label });
  }

  return (
    <Breadcrumb data-testid="breadcrumbs">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/">
              <Home className="w-3.5 h-3.5" />
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((crumb, i) => (
          <span key={i} className="contents">
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {crumb.href && i < crumbs.length - 1 ? (
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
