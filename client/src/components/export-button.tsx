import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileJson, Loader2 } from "lucide-react";

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
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport(format: "csv" | "json") {
    setIsExporting(true);
    try {
      await triggerDownload(endpoint, format, filename);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={isExporting}>
          {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onClick={() => handleExport("csv")}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onClick={() => handleExport("json")}
        >
          <FileJson className="w-4 h-4" />
          Export JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
