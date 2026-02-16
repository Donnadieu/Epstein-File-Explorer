import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, Download } from "lucide-react";

interface BatchResult {
  filename: string;
  path: string;
  source_url?: string;
  pages: number;
  is_hit: boolean;
  has_vulnerabilities: boolean;
  has_recoverable_text: boolean;
  metadata_present: boolean;
  unredacted_generated: boolean;
  email_count?: number;
  emails_preview?: string[];
  email_domains?: string[];
  has_emails?: boolean;
  audit_type: string;
}

interface BatchSummary {
  total: number;
  analyzed: number;
  hits: number;
  vulnerable: number;
  recoverable: number;
  with_metadata: number;
  with_emails?: number;
  email_addresses_total?: number;
}

interface DojJobProgress {
  discovered: number;
  total: number;
  processed: number;
  successful: number;
  failed: number;
  currentUrl?: string;
  phase?: "discovering" | "processing";
  pagesScanned?: number;
}

interface DojJobStatusResponse {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt?: string;
  updatedAt?: string;
  cancelRequested?: boolean;
  progress: DojJobProgress;
  result?: {
    results: BatchResult[];
    summary: BatchSummary;
    discovered: number;
  };
  error?: string;
}

interface EmailAuditResultItem {
  file: string;
  email_count: number;
  emails_preview: string[];
  email_domains: string[];
}

interface EmailAuditSummary {
  files_scanned: number;
  files_with_emails: number;
  email_addresses_total: number;
}

const DOJ_JOB_STORAGE_KEY = "epstein-doj-batch-job-id";

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
    return decodeURIComponent(rawName);
  } catch {
    return url;
  }
}

export function BatchAudit() {
  const [source, setSource] = useState<"local" | "doj">("local");
  const [directory, setDirectory] = useState("data");
  const [filter, setFilter] = useState<"all" | "hits" | "vulnerable" | "recoverable">("hits");
  const [maxFiles, setMaxFiles] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dojJobId, setDojJobId] = useState<string | null>(null);
  const [dojProgress, setDojProgress] = useState<DojJobProgress | null>(null);
  const [dojCreatedAt, setDojCreatedAt] = useState<string | null>(null);
  const [dojUpdatedAt, setDojUpdatedAt] = useState<string | null>(null);
  const [lastPollAtMs, setLastPollAtMs] = useState<number | null>(null);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const [emailAuditLoading, setEmailAuditLoading] = useState(false);
  const [emailAuditSummary, setEmailAuditSummary] = useState<EmailAuditSummary | null>(null);
  const [emailAuditResults, setEmailAuditResults] = useState<EmailAuditResultItem[]>([]);

  const pollDojJob = async (jobId: string) => {
    const response = await fetch(`/api/tools/batch-audit-doj/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error("Failed to fetch DOJ batch audit job status");
    }

    const status: DojJobStatusResponse = await response.json();
    setLastPollAtMs(Date.now());
    setDojProgress(status.progress);
    if (status.createdAt) {
      setDojCreatedAt(status.createdAt);
    }
    if (status.updatedAt) {
      setDojUpdatedAt(status.updatedAt);
    }

    if (status.status === "completed") {
      setLoading(false);
      setCancelling(false);
      setDojJobId(null);
      setDojProgress(null);
      setDojCreatedAt(null);
      setDojUpdatedAt(null);
      setLastPollAtMs(null);
      localStorage.removeItem(DOJ_JOB_STORAGE_KEY);
      if (status.result) {
        setResults(status.result.results);
        setSummary(status.result.summary);
      }
      return true;
    }

    if (status.status === "failed") {
      setLoading(false);
      setCancelling(false);
      setDojJobId(null);
      setDojProgress(null);
      setDojCreatedAt(null);
      setDojUpdatedAt(null);
      setLastPollAtMs(null);
      localStorage.removeItem(DOJ_JOB_STORAGE_KEY);
      throw new Error(status.error || "DOJ batch audit job failed");
    }

    if (status.status === "cancelled") {
      setLoading(false);
      setCancelling(false);
      setDojJobId(null);
      setDojProgress(null);
      setDojCreatedAt(null);
      setDojUpdatedAt(null);
      setLastPollAtMs(null);
      localStorage.removeItem(DOJ_JOB_STORAGE_KEY);
      setError("DOJ batch audit was cancelled.");
      return true;
    }

    return false;
  };

  const cancelDojJob = async () => {
    if (!dojJobId || cancelling) return;

    try {
      setCancelling(true);
      const response = await fetch(`/api/tools/batch-audit-doj/jobs/${dojJobId}/cancel`, {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to cancel DOJ batch audit job");
      }

      setError(null);
    } catch (err) {
      setError(String(err));
      setCancelling(false);
    }
  };

  useEffect(() => {
    const savedJobId = localStorage.getItem(DOJ_JOB_STORAGE_KEY);
    if (!savedJobId) return;

    setSource("doj");
    setDojJobId(savedJobId);
    setLoading(true);
  }, []);

  useEffect(() => {
    if (!dojJobId) return;

    let active = true;
    const tick = async () => {
      try {
        const done = await pollDojJob(dojJobId);
        if (done && active) return;
      } catch (err) {
        if (!active) return;
        setError(String(err));
        setLoading(false);
        setCancelling(false);
        setDojJobId(null);
        setDojProgress(null);
        setDojCreatedAt(null);
        setDojUpdatedAt(null);
        setLastPollAtMs(null);
        localStorage.removeItem(DOJ_JOB_STORAGE_KEY);
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 2000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [dojJobId]);

  useEffect(() => {
    if (!(loading && source === "doj" && dojJobId)) return;

    const ticker = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => window.clearInterval(ticker);
  }, [loading, source, dojJobId]);

  const runBatchAudit = async () => {
    try {
      setLoading(true);
      setCancelling(false);
      setError(null);
      setResults([]);
      setSummary(null);

      if (source === "doj") {
        const response = await fetch("/api/tools/batch-audit-doj/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filter,
            maxFiles: maxFiles.trim() ? Number(maxFiles) : undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to start DOJ batch audit job");
        }

        const jobData = await response.json();
        const jobId = String(jobData.jobId);
        setDojJobId(jobId);
        setDojCreatedAt(new Date().toISOString());
        setDojUpdatedAt(new Date().toISOString());
        setLastPollAtMs(Date.now());
        setDojProgress({
          discovered: 0,
          total: 0,
          processed: 0,
          successful: 0,
          failed: 0,
        });
        localStorage.setItem(DOJ_JOB_STORAGE_KEY, jobId);
        return;
      }

      const response = await fetch("/api/tools/batch-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory, filter }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Batch audit failed");
      }

      const data = await response.json();
      setResults(data.results);
      setSummary(data.summary);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    } finally {
      if (source !== "doj") {
        setLoading(false);
      }
    }
  };

  const exportResults = async () => {
    try {
      const response = await fetch("/api/tools/batch-audit-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results }),
      });

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "batch-audit-results.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    }
  };

  const exportEmailAudit = () => {
    if (emailAuditResults.length === 0) return;
    const headers = ["File", "Email Count", "Domains", "Preview"];
    const rows = emailAuditResults.map((item) => [
      item.file,
      String(item.email_count || 0),
      (item.email_domains || []).join(" | "),
      (item.emails_preview || []).join(" | "),
    ]);

    const escapeCsv = (value: string) => {
      if (value.includes(",") || value.includes("\n") || value.includes("\"")) {
        return `"${value.replace(/\"/g, '""')}"`;
      }
      return value;
    };

    const csv = [headers.map(escapeCsv).join(",")]
      .concat(rows.map((row) => row.map((val) => escapeCsv(String(val))).join(",")))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "email-audit-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runEmailAuditAi = async () => {
    try {
      setEmailAuditLoading(true);
      setError(null);

      const response = await fetch("/api/tools/email-audit-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to run AI email audit");
      }

      const payload = await response.json();
      setEmailAuditSummary(payload.summary || null);
      setEmailAuditResults(Array.isArray(payload.results) ? payload.results : []);
    } catch (err) {
      setError(String(err));
    } finally {
      setEmailAuditLoading(false);
    }
  };

  const processed = dojProgress?.processed ?? 0;
  const total = dojProgress?.total ?? 0;
  const discovered = dojProgress?.discovered ?? 0;
  const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;

  const startedMs = dojCreatedAt ? new Date(dojCreatedAt).getTime() : NaN;
  const updatedMs = dojUpdatedAt ? new Date(dojUpdatedAt).getTime() : NaN;
  const elapsedMs = Number.isFinite(startedMs) ? Math.max(0, nowTs - startedMs) : 0;
  const sinceServerUpdateMs = Number.isFinite(updatedMs) ? Math.max(0, nowTs - updatedMs) : NaN;
  const sincePollMs = Number.isFinite(lastPollAtMs as number) ? Math.max(0, nowTs - (lastPollAtMs as number)) : NaN;
  const staleUpdates = Number.isFinite(sinceServerUpdateMs) && sinceServerUpdateMs > 15000;
  const ratePerMinute = elapsedMs > 0 ? (processed / elapsedMs) * 60000 : 0;
  const remaining = Math.max(0, total - processed);
  const etaMs = ratePerMinute > 0 ? (remaining / ratePerMinute) * 60000 : null;

  const dojPhase = dojProgress?.phase === "discovering"
    ? "Discovering DOJ pages..."
    : total === 0
      ? (discovered > 0 ? "Preparing queue from discovered pages..." : "Discovering DOJ pages...")
      : "Scanning PDFs...";

  return (
    <div className="space-y-4 p-4">
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 rounded-lg">
        <h2 className="text-2xl font-bold mb-2">⚡ Batch PDF Audit</h2>
        <p className="text-sm opacity-90">
          Mass analyze PDFs and identify files with redaction vulnerabilities or recoverable text
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div>
          <label className="text-sm font-medium">Source</label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => setSource("local")}
              className={`p-2 rounded text-sm font-medium transition-colors ${
                source === "local"
                  ? "bg-blue-600 text-white"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              Local Directory
            </button>
            <button
              onClick={() => setSource("doj")}
              className={`p-2 rounded text-sm font-medium transition-colors ${
                source === "doj"
                  ? "bg-blue-600 text-white"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              DOJ Disclosures (Auto)
            </button>
          </div>
        </div>

        {source === "local" ? (
          <div>
            <label className="text-sm font-medium">Directory Path</label>
            <Input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="/path/to/pdfs"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Enter the directory containing PDF files to analyze
            </p>
          </div>
        ) : (
          <div>
            <label className="text-sm font-medium">Max Files (optional)</label>
            <Input
              value={maxFiles}
              onChange={(e) => setMaxFiles(e.target.value)}
              placeholder="Leave blank to audit all discovered DOJ PDFs"
              className="mt-1"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Automatically discovers PDFs from DOJ disclosure data-set pages and audits them without manual download.
              {maxFiles.trim() && (
                <span className="block mt-1 text-amber-700">
                  Active limit: {maxFiles.trim()} files
                </span>
              )}
            </p>
          </div>
        )}

        <div>
          <label className="text-sm font-medium">Filter Results</label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {(["all", "hits", "vulnerable", "recoverable"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setFilter(opt)}
                className={`p-2 rounded text-sm font-medium transition-colors ${
                  filter === opt
                    ? "bg-blue-600 text-white"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                {opt === "all"
                  ? "All Files"
                  : opt === "hits"
                    ? "⚠️ Hits Only"
                    : opt === "vulnerable"
                      ? "Vulnerabilities"
                      : "Recoverable"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Button
            onClick={runBatchAudit}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading
              ? source === "doj"
                ? "Running DOJ Batch Audit..."
                : "Analyzing..."
              : source === "doj"
                ? "Start DOJ Batch Audit"
                : "Start Batch Audit"}
          </Button>

          {source === "doj" && loading && dojJobId ? (
            <Button
              onClick={cancelDojJob}
              variant="outline"
              disabled={cancelling}
              className="w-full"
            >
              {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cancelling ? "Cancelling..." : "Stop Job"}
            </Button>
          ) : (
            <div className="hidden md:block" />
          )}
        </div>

        <Button
          onClick={runEmailAuditAi}
          variant="outline"
          disabled={emailAuditLoading}
          className="w-full"
        >
          {emailAuditLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {emailAuditLoading ? "Running Email Audit..." : "Run Email Audit (AI JSON)"}
        </Button>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {source === "doj" && loading && dojJobId && dojProgress && (
        <Card className="p-4">
          <h3 className="font-bold mb-3">⏳ DOJ Batch Progress</h3>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Job: <span className="font-mono">{dojJobId}</span>
            </p>
            <p className="font-medium">{dojPhase}</p>
            <p>
              Processed <span className="font-semibold">{processed}</span> / {total} files
              <span className="text-muted-foreground"> ({progressPercent}%)</span>
              {discovered > total && (
                <span className="text-muted-foreground"> • discovered {discovered}</span>
              )}
              {dojProgress.pagesScanned && dojProgress.phase === "discovering" && (
                <span className="text-muted-foreground"> • pages scanned {dojProgress.pagesScanned}</span>
              )}
            </p>
            <div className="w-full bg-muted rounded h-2 overflow-hidden">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-muted-foreground">
              Success: {dojProgress.successful} • Failed: {dojProgress.failed}
            </p>
            <p className="text-muted-foreground">
              Elapsed: {formatDuration(elapsedMs)} • Rate: {ratePerMinute > 0 ? `${ratePerMinute.toFixed(1)} files/min` : "—"}
              {etaMs && Number.isFinite(etaMs) ? ` • ETA: ${formatDuration(etaMs)}` : ""}
            </p>
            <p className="text-muted-foreground">
              Updates: {Number.isFinite(sinceServerUpdateMs) ? `${Math.floor(sinceServerUpdateMs / 1000)}s ago` : "waiting"}
              {Number.isFinite(sincePollMs) ? ` • poll ${Math.floor(sincePollMs / 1000)}s ago` : ""}
            </p>
            {staleUpdates ? (
              <p className="text-amber-600 font-medium">⚠️ No new server progress in the last 15s. Still polling...</p>
            ) : (
              <p className="text-green-600 font-medium">● Live updates active</p>
            )}
            {dojProgress.currentUrl && (
              <p className="text-xs text-muted-foreground break-all">
                Current: {fileNameFromUrl(dojProgress.currentUrl)}
                <span className="opacity-70"> • {dojProgress.currentUrl}</span>
              </p>
            )}
          </div>
        </Card>
      )}

      {summary && (
        <Card className="p-4">
          <h3 className="font-bold mb-3">📊 Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold">{summary.total}</div>
              <div className="text-xs text-muted-foreground">Total Files</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-orange-600">{summary.hits}</div>
              <div className="text-xs text-muted-foreground">⚠️ Hits</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-red-600">{summary.vulnerable}</div>
              <div className="text-xs text-muted-foreground">Vulnerable</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-green-600">{summary.recoverable}</div>
              <div className="text-xs text-muted-foreground">Recoverable</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-yellow-600">{summary.with_metadata}</div>
              <div className="text-xs text-muted-foreground">With Metadata</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-blue-600">{summary.with_emails ?? 0}</div>
              <div className="text-xs text-muted-foreground">With Emails</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold">{summary.analyzed}</div>
              <div className="text-xs text-muted-foreground">Analyzed OK</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-indigo-600">{summary.email_addresses_total ?? 0}</div>
              <div className="text-xs text-muted-foreground">Emails Found</div>
            </div>
          </div>
        </Card>
      )}

      {results.length > 0 && (
        <Button
          onClick={exportResults}
          variant="outline"
          className="w-full"
        >
          <Download className="mr-2 h-4 w-4" />
          Export as CSV
        </Button>
      )}

      {emailAuditSummary && (
        <Card className="p-4">
          <h3 className="font-bold mb-3">✉️ Email Audit Summary (AI JSON)</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold">{emailAuditSummary.files_scanned}</div>
              <div className="text-xs text-muted-foreground">Files Scanned</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-indigo-600">{emailAuditSummary.files_with_emails}</div>
              <div className="text-xs text-muted-foreground">Files With Emails</div>
            </div>
            <div className="bg-muted p-3 rounded">
              <div className="text-2xl font-bold text-blue-600">{emailAuditSummary.email_addresses_total}</div>
              <div className="text-xs text-muted-foreground">Email Addresses</div>
            </div>
          </div>
        </Card>
      )}

      {emailAuditResults.length > 0 && (
        <Button onClick={exportEmailAudit} variant="outline" className="w-full">
          <Download className="mr-2 h-4 w-4" />
          Export Email Audit CSV
        </Button>
      )}

      {emailAuditResults.length > 0 && (
        <Card className="p-4 overflow-x-auto">
          <h3 className="font-bold mb-3">✉️ Email Artifacts ({emailAuditResults.length})</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-semibold">File</th>
                <th className="text-center py-2 px-2 font-semibold">Emails</th>
                <th className="text-left py-2 px-2 font-semibold">Domains</th>
                <th className="text-left py-2 px-2 font-semibold">Preview</th>
              </tr>
            </thead>
            <tbody>
              {emailAuditResults.slice(0, 150).map((item) => (
                <tr key={item.file} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-2 font-mono text-xs">{item.file}</td>
                  <td className="py-2 px-2 text-center font-semibold text-indigo-600">{item.email_count}</td>
                  <td className="py-2 px-2 text-xs">{item.email_domains.join(", ") || "—"}</td>
                  <td className="py-2 px-2 text-xs">{item.emails_preview.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {results.length > 0 && (
        <Card className="p-4 overflow-x-auto">
          <h3 className="font-bold mb-3">📋 Results ({results.length})</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-semibold">File</th>
                <th className="text-center py-2 px-2 font-semibold">Pages</th>
                <th className="text-center py-2 px-2 font-semibold">Audit Type</th>
                <th className="text-center py-2 px-2 font-semibold">Status</th>
                <th className="text-center py-2 px-2 font-semibold">Vulnerabilities</th>
                <th className="text-center py-2 px-2 font-semibold">Recoverable</th>
                <th className="text-center py-2 px-2 font-semibold">Metadata</th>
                <th className="text-center py-2 px-2 font-semibold">Emails</th>
                <th className="text-center py-2 px-2 font-semibold">Unredacted</th>
                <th className="text-left py-2 px-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, idx) => (
                <tr key={idx} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-2 font-mono text-xs max-w-xs truncate">
                    {result.filename}
                  </td>
                  <td className="py-2 px-2 text-center">{result.pages}</td>
                  <td className="py-2 px-2 text-center text-xs">{result.audit_type || "unknown"}</td>
                  <td className="py-2 px-2 text-center">
                    {result.is_hit ? (
                      <span className="px-2 py-1 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 rounded text-xs font-bold">
                        ⚠️ HIT
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded text-xs font-bold">
                        ✓ Clean
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {result.has_vulnerabilities ? (
                      <span className="text-red-600 font-bold">YES</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {result.has_recoverable_text ? (
                      <span className="text-green-600 font-bold">YES</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {result.metadata_present ? (
                      <span className="text-yellow-600 font-bold">YES</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-xs">
                    {(result.email_count || 0) > 0 ? (
                      <span className="text-indigo-600 font-bold" title={(result.emails_preview || []).join(", ")}>
                        {result.email_count}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {result.unredacted_generated ? (
                      <span className="text-blue-600 font-bold">YES</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-xs max-w-xs truncate">
                    {result.source_url ? (
                      <a
                        href={result.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                        title={result.source_url}
                      >
                        {fileNameFromUrl(result.source_url)}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!loading && results.length === 0 && summary === null && (
        <Card className="p-8 text-center text-muted-foreground">
          <p>
            {source === "doj"
              ? 'Choose "DOJ Disclosures (Auto)" and click "Start DOJ Batch Audit" to discover and analyze DOJ PDFs.'
              : 'Enter a directory path and click "Start Batch Audit" to analyze PDFs.'}
          </p>
        </Card>
      )}
    </div>
  );
}