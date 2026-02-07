import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileJson } from "lucide-react";

interface ExportButtonProps {
  endpoint: string;
  filename: string;
  label?: string;
}

async function triggerDownload(endpoint: string, format: "csv" | "json", filename: string) {
  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `${endpoint}${separator}format=${format}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function ExportButton({ endpoint, filename, label = "Export" }: ExportButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="w-3.5 h-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onClick={() => triggerDownload(endpoint, "csv", filename)}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onClick={() => triggerDownload(endpoint, "json", filename)}
        >
          <FileJson className="w-4 h-4" />
          Export JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
