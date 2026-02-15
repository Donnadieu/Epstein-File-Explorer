import { useState, useEffect } from "react";
import { AlertCircle, Eye, Zap, FileText, Loader2, Check, Copy, Upload, Link as LinkIcon, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchAudit } from "./batch-audit";

interface FileItem {
  name: string;
  isDirectory: boolean;
  path: string;
  size?: number;
}

interface AnalysisResult {
  success: boolean;
  path: string;
  audit?: Record<string, unknown>;
  xray?: Record<string, unknown>;
  metadata?: {
    file_properties?: Record<string, unknown>;
    document_info?: Record<string, unknown>;
    xmp_metadata?: Record<string, unknown>;
    embedded_files?: Array<Record<string, unknown>>;
    security?: Record<string, unknown>;
    summary?: Record<string, unknown>;
  };
  extractedPath?: string;
  extractedText?: Record<string, unknown>;
  unredactedPath?: string;
  unredactionStats?: {
    redaction_boxes_found?: number;
    words_under_redactions?: number;
    chars_under_redactions?: number;
    total_words_extracted?: number;
    total_chars_extracted?: number;
    recovery_rate?: number;
  };
  error?: string;
}

type InputMethod = "browse" | "upload" | "url";

export function PDFTools() {
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [currentDir, setCurrentDir] = useState(
    "data"
  );
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [toolsReady, setToolsReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputMethod, setInputMethod] = useState<InputMethod>("browse");
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Check if tools are ready
  useEffect(() => {
    checkToolsHealth();
  }, []);

  // Browse files when directory changes
  useEffect(() => {
    browseDirectory(currentDir);
  }, [currentDir]);

  const checkToolsHealth = async () => {
    try {
      const res = await fetch("/api/tools/health");
      const data = await res.json();
      setToolsReady(data.ready);
    } catch (error) {
      console.error("Failed to check tools health:", error);
      setToolsReady(false);
    }
  };

  const browseDirectory = async (dir: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tools/browse?dir=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (data.success) {
        setFiles(data.items);
      }
    } catch (error) {
      console.error("Failed to browse directory:", error);
    } finally {
      setLoading(false);
    }
  };

  const analyzePDF = async (filePath: string) => {
    setAnalyzing(true);
    try {
      console.log("[PDF Analysis] Starting analysis of:", filePath);
      const res = await fetch(
        `/api/tools/analyze?path=${encodeURIComponent(filePath)}&extract=true`,
        { method: "POST" }
      );
      
      console.log("[PDF Analysis] Response status:", res.status);
      console.log("[PDF Analysis] Response headers:", Array.from(res.headers.entries()));
      
      const responseText = await res.text();
      console.log("[PDF Analysis] Raw response text (first 500 chars):", responseText.substring(0, 500));
      
      let data;
      
      try {
        data = JSON.parse(responseText);
        console.log("[PDF Analysis] Successfully parsed JSON");
      } catch (parseError) {
        console.error("[PDF Analysis] JSON parse error:", parseError);
        console.error("[PDF Analysis] Response that failed to parse:", responseText);
        setAnalysisResult({
          success: false,
          path: filePath,
          error: `Server error (${res.status}): Invalid response format. Response: ${responseText.substring(0, 100)}`,
        });
        setAnalyzing(false);
        return;
      }
      
      if (!res.ok) {
        setAnalysisResult({
          success: false,
          path: filePath,
          error: data.error || `Analysis failed with status ${res.status}`,
        });
      } else {
        setAnalysisResult(data);
      }
    } catch (error) {
      console.error("[PDF Analysis] Fetch error:", error);
      setAnalysisResult({
        success: false,
        path: filePath,
        error: "Failed to analyze PDF: " + (error as Error).message,
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please select a PDF file");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setLoading(true);
      const response = await fetch("/api/tools/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      setSelectedFile(data.path);
      setUploadedFileName(file.name);
      setAnalysisResult(null);
    } catch (error) {
      alert("Failed to upload file: " + (error as Error).message);
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlInput.trim()) {
      alert("Please enter a URL");
      return;
    }

    try {
      setUrlLoading(true);
      const response = await fetch("/api/tools/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Download failed");
      }

      const data = await response.json();
      setSelectedFile(data.path);
      setUploadedFileName(data.filename);
      setUrlInput("");
      setAnalysisResult(null);
    } catch (error) {
      alert("Failed to download PDF: " + (error as Error).message);
    } finally {
      setUrlLoading(false);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "-";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">PDF Analysis Tools</h1>
          <p className="text-muted-foreground">
            Select PDF files to analyze for hidden text, bad redactions, and more
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={mode === "single" ? "default" : "outline"}
            onClick={() => setMode("single")}
          >
            Single File
          </Button>
          <Button
            variant={mode === "batch" ? "default" : "outline"}
            onClick={() => setMode("batch")}
          >
            Batch Audit
          </Button>
        </div>
      </div>

      {/* Tools Status */}
      {!toolsReady && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Python tools are not ready. Make sure the server is running properly.
          </AlertDescription>
        </Alert>
      )}

      {toolsReady && (
        <Alert>
          <Check className="h-4 w-4" />
          <AlertDescription>
            All PDF analysis tools are ready and running locally on your system.
          </AlertDescription>
        </Alert>
      )}

      {mode === "batch" && (
        <BatchAudit />
      )}

      {mode === "single" && (
        <div className="grid gap-6 md:grid-cols-2">
        {/* File Browser */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              PDF Source
            </CardTitle>
            <CardDescription>
              Select or provide a PDF to analyze
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs 
              value={inputMethod} 
              onValueChange={(v) => {
                setInputMethod(v as InputMethod);
                setSelectedFile(null);
                setUploadedFileName(null);
                setAnalysisResult(null);
              }}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="browse">Browse</TabsTrigger>
                <TabsTrigger value="upload">Upload</TabsTrigger>
                <TabsTrigger value="url">From URL</TabsTrigger>
              </TabsList>

              {/* Browse Method */}
              <TabsContent value="browse" className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Current Directory</label>
                  <Input
                    value={currentDir}
                    onChange={(e) => setCurrentDir(e.target.value)}
                    placeholder="/path/to/pdfs"
                    className="mt-1"
                  />
                </div>

                <div className="border rounded-lg p-3 space-y-2 max-h-96 overflow-y-auto">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : files.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No files found in this directory
                    </p>
                  ) : (
                    files.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => {
                          if (file.isDirectory) {
                            setCurrentDir(file.path);
                          } else if (file.name.toLowerCase().endsWith(".pdf")) {
                            setSelectedFile(file.path);
                            setUploadedFileName(null);
                          }
                        }}
                        className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${
                          selectedFile === file.path
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        } ${
                          file.name.toLowerCase().endsWith(".pdf")
                            ? "cursor-pointer"
                            : file.isDirectory
                              ? "cursor-pointer"
                              : "opacity-50"
                        }`}
                      >
                        {file.isDirectory ? (
                          <ChevronRight className="h-4 w-4 opacity-50" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        <span className="flex-1 truncate">{file.name}</span>
                        {file.size && (
                          <span className="text-xs opacity-50">
                            {formatBytes(file.size)}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Upload Method */}
              <TabsContent value="upload" className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-4">
                  <div className="flex justify-center">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Upload PDF File</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a PDF from your computer
                    </p>
                  </div>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    disabled={loading}
                    className="hidden"
                    id="pdf-upload"
                  />
                  <Button
                    asChild
                    variant="outline"
                    disabled={loading}
                  >
                    <label htmlFor="pdf-upload" className="cursor-pointer">
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Choose File
                        </>
                      )}
                    </label>
                  </Button>
                </div>
                {uploadedFileName && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-sm font-medium text-green-900 dark:text-green-100">
                      ✓ Uploaded: {uploadedFileName}
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* URL Method */}
              <TabsContent value="url" className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">PDF URL</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Enter a direct link to a PDF file
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="url"
                        placeholder="https://example.com/document.pdf"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        disabled={urlLoading}
                        className="flex-1"
                      />
                      <Button
                        onClick={handleUrlSubmit}
                        disabled={urlLoading || !urlInput.trim()}
                      >
                        {urlLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <LinkIcon className="h-4 w-4 mr-2" />
                            Download
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-900 dark:text-blue-100">
                    <p className="font-medium mb-1">Supported Sources:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Direct PDF links (http/https)</li>
                      <li>DOJ Epstein Library documents</li>
                      <li>Court documents (PACER, etc.)</li>
                      <li>Any publicly accessible PDF</li>
                    </ul>
                  </div>
                </div>
                {uploadedFileName && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-sm font-medium text-green-900 dark:text-green-100">
                      ✓ Downloaded: {uploadedFileName}
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {selectedFile && (
              <Button
                onClick={() => analyzePDF(selectedFile)}
                disabled={analyzing || !toolsReady}
                className="w-full"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Analyze PDF
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Analysis Results */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Analysis Results
            </CardTitle>
            <CardDescription>
              Real-time detection of redaction vulnerabilities
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!analysisResult ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Select a PDF file and click "Analyze PDF" to see results
              </p>
            ) : analysisResult.error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{analysisResult.error}</AlertDescription>
              </Alert>
            ) : (
              <Tabs defaultValue="audit" className="space-y-4">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                  <TabsTrigger value="xray">X-ray</TabsTrigger>
                  <TabsTrigger value="metadata">Metadata</TabsTrigger>
                  <TabsTrigger value="extract">Extract</TabsTrigger>
                  <TabsTrigger value="unredacted">Unredacted</TabsTrigger>
                </TabsList>

                <TabsContent value="audit" className="space-y-2">
                  {analysisResult.audit ? (
                    <div className="space-y-3">
                      <div className="bg-muted p-3 rounded-lg space-y-2 text-sm max-h-64 overflow-y-auto">
                        <div>
                          <span className="font-medium">File Size:</span>{" "}
                          {analysisResult.audit.size_bytes} bytes
                        </div>
                        <div>
                          <span className="font-medium">Pages:</span>{" "}
                          {analysisResult.audit.pages}
                        </div>
                        <div>
                          <span className="font-medium">Encrypted:</span>{" "}
                          {String(analysisResult.audit.encrypted)}
                        </div>
                        <div>
                          <span className="font-medium">Pages with Fonts:</span>{" "}
                          {analysisResult.audit.pages_with_fonts}
                        </div>
                        <div>
                          <span className="font-medium">Pages with Images:</span>{" "}
                          {analysisResult.audit.pages_with_images}
                        </div>
                        <div className="pt-2 border-t">
                          <span className="font-medium">Classification:</span>
                          <p className="text-yellow-600 dark:text-yellow-500 mt-1">
                            {analysisResult.audit.likely_type}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyToClipboard(JSON.stringify(analysisResult.audit, null, 2))
                        }
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {copied ? "Copied" : "Copy JSON"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No audit data available
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="xray" className="space-y-2">
                  {analysisResult.xray && Object.keys(analysisResult.xray).length > 0 ? (
                    <div className="space-y-3">
                      <div className="bg-muted p-3 rounded-lg space-y-2 text-sm max-h-64 overflow-y-auto">
                        <pre className="whitespace-pre-wrap break-words">{JSON.stringify(analysisResult.xray, null, 2)}</pre>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyToClipboard(JSON.stringify(analysisResult.xray, null, 2))
                        }
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy JSON
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No x-ray detection data or PDF appears clean
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="metadata" className="space-y-2">
                  {analysisResult.metadata ? (
                    <div className="space-y-3">
                      {/* File Properties */}
                      {analysisResult.metadata.file_properties && (
                        <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                          <h4 className="font-semibold text-base">File Properties</h4>
                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(analysisResult.metadata.file_properties).map(([key, value]) => (
                              <div key={key}>
                                <span className="font-medium capitalize">{key.replace(/_/g, ' ')}:</span>{" "}
                                {String(value)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Metadata Stripped Warning */}
                      {analysisResult.metadata.document_info && 
                       Object.keys(analysisResult.metadata.document_info).length === 0 &&
                       !analysisResult.metadata.summary.has_xmp && (
                        <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg border-2 border-green-400 dark:border-green-600">
                          <h4 className="font-bold text-lg text-green-900 dark:text-green-100 mb-2">
                            ✅ Metadata Has Been Stripped
                          </h4>
                          <div className="space-y-2 text-sm text-green-800 dark:text-green-200">
                            <p className="font-medium">
                              This PDF contains <span className="font-bold">NO document metadata</span> (no Creator, Producer, Author, or timestamps).
                            </p>
                            
                            <div className="bg-green-100 dark:bg-green-900 p-3 rounded border border-green-300 dark:border-green-700">
                              <div className="font-semibold mb-2">🔍 What This Means:</div>
                              <ul className="space-y-1 text-xs ml-4">
                                <li>✅ <span className="font-medium">Good Security Practice:</span> DOJ/FBI properly sanitized metadata before release</li>
                                <li>✅ <span className="font-medium">No Personnel Leaks:</span> No individual names or organizations exposed</li>
                                <li>✅ <span className="font-medium">No Software Fingerprints:</span> Processing pipeline cannot be reverse-engineered</li>
                                <li>❌ <span className="font-medium">Lost Intelligence:</span> Cannot determine processing timeline or tools used</li>
                              </ul>
                            </div>

                            <div className="bg-white dark:bg-gray-800 p-2 rounded border border-green-300 dark:border-green-700 text-xs">
                              <div className="font-semibold text-green-800 dark:text-green-200 mb-1">🎯 Forensic Notes:</div>
                              <ul className="space-y-0.5 text-green-700 dark:text-green-300 ml-4">
                                <li>• Metadata likely removed using tools like <code className="bg-green-200 dark:bg-green-800 px-1 rounded">exiftool -all=</code> or Adobe's Remove Hidden Information</li>
                                <li>• This is standard practice for FOIA releases to protect operational security</li>
                                <li>• File properties (size, PDF version) still reveal some processing info</li>
                                <li>• Compare with other documents - inconsistent metadata removal may indicate different processing batches</li>
                              </ul>
                            </div>

                            <div className="text-xs italic text-green-700 dark:text-green-300 pt-2 border-t border-green-300 dark:border-green-700">
                              💡 <span className="font-medium">Tip:</span> Try analyzing other Epstein PDFs to find ones with metadata still present - those may reveal processing details.
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Document Info - Forensic Intelligence Display */}
                      {analysisResult.metadata.document_info && 
                       Object.keys(analysisResult.metadata.document_info).length > 0 && (
                        <div className="bg-yellow-50 dark:bg-yellow-950 p-4 rounded-lg border-2 border-yellow-400 dark:border-yellow-600 space-y-3">
                          <div className="space-y-1">
                            <h4 className="font-bold text-lg text-yellow-900 dark:text-yellow-100">
                              ⚠️ Document Metadata - Forensic Intelligence
                            </h4>
                            <p className="text-xs text-yellow-800 dark:text-yellow-200 italic">
                              This information reveals the document's processing history and may expose sensitive operational details
                            </p>
                          </div>

                          {/* Raw Metadata */}
                          <div className="bg-yellow-100 dark:bg-yellow-900 p-3 rounded border border-yellow-300 dark:border-yellow-700">
                            <div className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2">📄 Raw Metadata:</div>
                            <div className="space-y-1 text-sm">
                              {Object.entries(analysisResult.metadata.document_info).map(([key, value]) => (
                                <div key={key} className="font-mono">
                                  <span className="font-semibold text-yellow-800 dark:text-yellow-200">{key}:</span>{" "}
                                  <span className="text-yellow-900 dark:text-yellow-100">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Intelligence Analysis */}
                          <div className="space-y-2 text-sm">
                            <div className="font-semibold text-yellow-900 dark:text-yellow-100 text-base">🔬 What This Reveals:</div>
                            
                            {/* Processing Pipeline */}
                            {(analysisResult.metadata.document_info.Creator || analysisResult.metadata.document_info.Producer) && (
                              <div className="bg-white dark:bg-gray-800 p-2 rounded border border-yellow-300 dark:border-yellow-700">
                                <div className="font-semibold text-yellow-800 dark:text-yellow-200">🔧 Processing Pipeline:</div>
                                <ul className="ml-4 mt-1 space-y-1 text-xs">
                                  {analysisResult.metadata.document_info.Creator && (
                                    <li>
                                      <span className="font-medium">Creator Software:</span> {analysisResult.metadata.document_info.Creator}
                                      {analysisResult.metadata.document_info.Creator.includes('Adobe') && 
                                        <span className="ml-2 text-yellow-700 dark:text-yellow-300">(Commercial tooling - likely official channels)</span>
                                      }
                                      {(analysisResult.metadata.document_info.Creator.includes('pdftk') || 
                                        analysisResult.metadata.document_info.Creator.includes('itext')) && 
                                        <span className="ml-2 text-yellow-700 dark:text-yellow-300">(Open-source tools - automated or scripted processing)</span>
                                      }
                                    </li>
                                  )}
                                  {analysisResult.metadata.document_info.Producer && (
                                    <li>
                                      <span className="font-medium">PDF Generator:</span> {analysisResult.metadata.document_info.Producer}
                                      {analysisResult.metadata.document_info.Producer.toLowerCase().includes('nuance') && 
                                        <span className="ml-2 text-yellow-700 dark:text-yellow-300">(Government contractor common)</span>
                                      }
                                    </li>
                                  )}
                                </ul>
                              </div>
                            )}

                            {/* Personnel/Author Info */}
                            {analysisResult.metadata.document_info.Author && (
                              <div className="bg-red-50 dark:bg-red-950 p-2 rounded border border-red-300 dark:border-red-700">
                                <div className="font-semibold text-red-800 dark:text-red-200">👤 Personnel Information Exposed:</div>
                                <div className="ml-4 mt-1 text-xs">
                                  <span className="font-medium">Author:</span> {analysisResult.metadata.document_info.Author}
                                  <div className="text-red-700 dark:text-red-300 mt-1 italic">
                                    ⚠️ This may reveal individual names, departments, or organizations involved in document processing
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Timeline Analysis */}
                            {(analysisResult.metadata.document_info.CreationDate || analysisResult.metadata.document_info.ModDate) && (
                              <div className="bg-white dark:bg-gray-800 p-2 rounded border border-yellow-300 dark:border-yellow-700">
                                <div className="font-semibold text-yellow-800 dark:text-yellow-200">⏰ Timeline Intelligence:</div>
                                <ul className="ml-4 mt-1 space-y-1 text-xs">
                                  {analysisResult.metadata.document_info.CreationDate && (
                                    <li>
                                      <span className="font-medium">Created:</span> {analysisResult.metadata.document_info.CreationDate}
                                      {(() => {
                                        const dateMatch = analysisResult.metadata.document_info.CreationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
                                        if (dateMatch) {
                                          const docYear = parseInt(dateMatch[1]);
                                          const currentYear = new Date().getFullYear();
                                          const yearDiff = currentYear - docYear;
                                          if (yearDiff > 2) {
                                            return <span className="ml-2 text-yellow-700 dark:text-yellow-300">(Document is {yearDiff} years old - check release dates)</span>;
                                          }
                                        }
                                        return null;
                                      })()}
                                    </li>
                                  )}
                                  {analysisResult.metadata.document_info.ModDate && (
                                    <li>
                                      <span className="font-medium">Modified:</span> {analysisResult.metadata.document_info.ModDate}
                                      {analysisResult.metadata.document_info.CreationDate === analysisResult.metadata.document_info.ModDate ? 
                                        <span className="ml-2 text-yellow-700 dark:text-yellow-300">(Same as creation - single processing session)</span> :
                                        <span className="ml-2 text-yellow-700 dark:text-yellow-300">(Modified after creation - multiple processing stages)</span>
                                      }
                                    </li>
                                  )}
                                </ul>
                              </div>
                            )}

                            {/* Government vs Contractor Analysis */}
                            {(analysisResult.metadata.document_info.Creator || analysisResult.metadata.document_info.Producer) && (
                              <div className="bg-white dark:bg-gray-800 p-2 rounded border border-yellow-300 dark:border-yellow-700">
                                <div className="font-semibold text-yellow-800 dark:text-yellow-200">🏛️ Organization Type:</div>
                                <div className="ml-4 mt-1 text-xs">
                                  {(() => {
                                    const software = `${analysisResult.metadata.document_info.Creator || ''} ${analysisResult.metadata.document_info.Producer || ''}`.toLowerCase();
                                    if (software.includes('nuance') || software.includes('kofax')) {
                                      return <span className="text-yellow-700 dark:text-yellow-300">📋 Likely Contractor: Enterprise document management systems commonly used by government contractors</span>;
                                    } else if (software.includes('adobe acrobat pro') || software.includes('adobe pdf')) {
                                      return <span className="text-yellow-700 dark:text-yellow-300">🏢 Government Agency: Adobe licenses common in official DOJ/FBI workflows</span>;
                                    } else if (software.includes('pdftk') || software.includes('itext') || software.includes('pypdf')) {
                                      return <span className="text-yellow-700 dark:text-yellow-300">💻 Automated Processing: Open-source tools indicate scripted/automated document handling</span>;
                                    } else {
                                      return <span className="text-yellow-700 dark:text-yellow-300">❓ Unknown pattern - compare with other documents to identify processing source</span>;
                                    }
                                  })()}
                                </div>
                              </div>
                            )}

                            {/* Software Vulnerabilities */}
                            <div className="bg-orange-50 dark:bg-orange-950 p-2 rounded border border-orange-300 dark:border-orange-700">
                              <div className="font-semibold text-orange-800 dark:text-orange-200">🔓 Security Implications:</div>
                              <ul className="ml-4 mt-1 space-y-1 text-xs text-orange-700 dark:text-orange-300">
                                <li>Software versions exposed may have known vulnerabilities</li>
                                <li>Processing timestamps reveal operational timelines</li>
                                <li>Tool choices indicate security posture (commercial vs open-source)</li>
                                <li>Cross-reference with other documents to identify batch processing patterns</li>
                              </ul>
                            </div>
                          </div>

                          {/* Action Items */}
                          <div className="bg-yellow-200 dark:bg-yellow-800 p-2 rounded text-xs">
                            <div className="font-semibold text-yellow-900 dark:text-yellow-100">🎯 Investigative Actions:</div>
                            <ul className="ml-4 mt-1 space-y-0.5 text-yellow-900 dark:text-yellow-100">
                              <li>• Compare metadata across multiple documents to identify processing batches</li>
                              <li>• Check if creation dates match official release claims</li>
                              <li>• Search for author/organization names in public records</li>
                              <li>• Research software version vulnerabilities and exploits</li>
                              <li>• Build timeline of document handling using modification dates</li>
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* XMP Metadata - Enhanced Display */}
                      {analysisResult.metadata.xmp_metadata && 
                       Object.keys(analysisResult.metadata.xmp_metadata).filter(k => !k.startsWith('_')).length > 0 && (
                        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border border-blue-200 dark:border-blue-800 space-y-2 text-sm">
                          <h4 className="font-semibold text-base text-blue-800 dark:text-blue-200">
                            🔍 XMP Extended Metadata
                          </h4>
                          <div className="space-y-3">
                            {/* Creator/Software Info */}
                            {(() => {
                              const creatorFields = Object.entries(analysisResult.metadata.xmp_metadata)
                                .filter(([key]) => 
                                  !key.startsWith('_') &&
                                  (key.includes('Creator') || 
                                  key.includes('Producer') || 
                                  key.includes('Tool') ||
                                  key.includes('photoshop') ||
                                  key.includes('exif'))
                                );
                              if (creatorFields.length > 0) {
                                return (
                                  <div>
                                    <div className="font-semibold mb-1 text-blue-700 dark:text-blue-300">Software & Tools:</div>
                                    {creatorFields.map(([key, value]) => (
                                      <div key={key} className="ml-2">
                                        <span className="font-medium">{key.replace(/^[^:]+:/, '')}:</span> {Array.isArray(value) ? value.join(', ') : String(value)}
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              return null;
                            })()}

                            {/* Dates */}
                            {(() => {
                              const dateFields = Object.entries(analysisResult.metadata.xmp_metadata)
                                .filter(([key]) => 
                                  !key.startsWith('_') &&
                                  (key.toLowerCase().includes('date') || key.toLowerCase().includes('time'))
                                );
                              if (dateFields.length > 0) {
                                return (
                                  <div>
                                    <div className="font-semibold mb-1 text-blue-700 dark:text-blue-300">Timestamps:</div>
                                    {dateFields.map(([key, value]) => (
                                      <div key={key} className="ml-2">
                                        <span className="font-medium">{key.replace(/^[^:]+:/, '')}:</span> {String(value)}
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              return null;
                            })()}

                            {/* Document Management */}
                            {(() => {
                              const mmFields = Object.entries(analysisResult.metadata.xmp_metadata)
                                .filter(([key]) => 
                                  !key.startsWith('_') &&
                                  (key.includes('xmpMM:') || key.includes('InstanceID') || key.includes('DocumentID'))
                                );
                              if (mmFields.length > 0) {
                                return (
                                  <div>
                                    <div className="font-semibold mb-1 text-blue-700 dark:text-blue-300">Document Management:</div>
                                    {mmFields.map(([key, value]) => (
                                      <div key={key} className="ml-2 text-xs">
                                        <span className="font-medium">{key.replace(/^[^:]+:/, '')}:</span> {String(value).substring(0, 60)}...
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              return null;
                            })()}

                            {/* Other XMP fields */}
                            {(() => {
                              const otherFields = Object.entries(analysisResult.metadata.xmp_metadata)
                                .filter(([key]) => 
                                  !key.startsWith('_') &&
                                  !key.toLowerCase().includes('date') &&
                                  !key.toLowerCase().includes('creator') &&
                                  !key.toLowerCase().includes('producer') &&
                                  !key.toLowerCase().includes('tool') &&
                                  !key.includes('xmpMM:') &&
                                  !key.includes('photoshop') &&
                                  !key.includes('exif')
                                );
                              if (otherFields.length > 0) {
                                return (
                                  <div>
                                    <div className="font-semibold mb-1 text-blue-700 dark:text-blue-300">Additional Properties:</div>
                                    {otherFields.map(([key, value]) => (
                                      <div key={key} className="ml-2 text-xs">
                                        <span className="font-medium">{key}:</span> {Array.isArray(value) ? value.join(', ') : String(value).substring(0, 100)}
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              return null;
                            })()}

                            {/* Raw XML info */}
                            {analysisResult.metadata.xmp_metadata._raw_xml_length && (
                              <div className="text-xs text-blue-600 dark:text-blue-400 pt-2 border-t border-blue-200 dark:border-blue-800">
                                Raw XMP XML: {analysisResult.metadata.xmp_metadata._raw_xml_length} bytes
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Security Info */}
                      {analysisResult.metadata.security && (
                        <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                          <h4 className="font-semibold text-base">Security Settings</h4>
                          <div className="space-y-1">
                            {Object.entries(analysisResult.metadata.security).map(([key, value]) => (
                              <div key={key}>
                                <span className="font-medium capitalize">{key.replace(/_/g, ' ')}:</span>{" "}
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Embedded Files */}
                      {analysisResult.metadata.embedded_files && 
                       analysisResult.metadata.embedded_files.length > 0 && (
                        <div className="bg-red-50 dark:bg-red-950 p-3 rounded-lg border border-red-200 dark:border-red-800">
                          <h4 className="font-semibold text-base text-red-800 dark:text-red-200">
                            ⚠️ Embedded Files Detected
                          </h4>
                          <div className="mt-2 space-y-2">
                            {analysisResult.metadata.embedded_files.map((file, idx) => (
                              <div key={idx} className="text-sm border-t pt-2">
                                {Object.entries(file).map(([key, value]) => (
                                  <div key={key}>
                                    <span className="font-medium">{key}:</span> {String(value)}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyToClipboard(JSON.stringify(analysisResult.metadata, null, 2))
                        }
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {copied ? "Copied" : "Copy All Metadata"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No metadata available
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="extract" className="space-y-2">
                  {analysisResult.extractedText ? (
                    <div className="space-y-3">
                      <p className="text-sm text-green-600 dark:text-green-500">
                        ✓ Hidden text extracted successfully
                      </p>
                      <div className="bg-muted p-3 rounded-lg text-sm max-h-64 overflow-y-auto">
                        <pre className="whitespace-pre-wrap break-words">{JSON.stringify(analysisResult.extractedText, null, 2)}</pre>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            copyToClipboard(JSON.stringify(analysisResult.extractedText, null, 2))
                          }
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy JSON
                        </Button>
                        {analysisResult.extractedPath && (
                          <a
                            href={`/api/tools/download-extracted?path=${encodeURIComponent(
                              analysisResult.extractedPath
                            )}`}
                            download
                          >
                            <Button size="sm" variant="outline">
                              <Download className="h-4 w-4 mr-2" />
                              Download JSON
                            </Button>
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No extracted text data available
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="unredacted" className="space-y-2">
                  {analysisResult.unredactedPath ? (
                    <div className="space-y-3">
                      {analysisResult.unredactionStats ? (
                        <div className="space-y-2">
                          <div className={`p-3 rounded-lg border ${
                            (analysisResult.unredactionStats.words_under_redactions || 0) > 0
                              ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800"
                              : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
                          }`}>
                            <p className={`text-sm font-medium ${
                              (analysisResult.unredactionStats.words_under_redactions || 0) > 0
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-blue-600 dark:text-blue-400"
                            }`}>
                              {(analysisResult.unredactionStats.words_under_redactions || 0) > 0
                                ? `⚠️ Found ${analysisResult.unredactionStats.words_under_redactions} words under ${analysisResult.unredactionStats.redaction_boxes_found} redaction boxes`
                                : `✓ PDF scanned: ${analysisResult.unredactionStats.redaction_boxes_found || 0} redaction boxes found`
                              }
                            </p>
                            {(analysisResult.unredactionStats.words_under_redactions || 0) > 0 && (
                              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                                Recovery rate: {analysisResult.unredactionStats.recovery_rate?.toFixed(2)}% of text was under redactions
                              </p>
                            )}
                            {(analysisResult.unredactionStats.words_under_redactions || 0) === 0 && 
                             (analysisResult.unredactionStats.total_words_extracted || 0) > 0 && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                No recoverable text found under redaction boxes. Either text was properly removed or boxes don't cover text.
                              </p>
                            )}
                          </div>
                          <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <span className="font-medium">Redaction Boxes:</span>{" "}
                                {analysisResult.unredactionStats.redaction_boxes_found || 0}
                              </div>
                              <div>
                                <span className="font-medium">Words Recovered:</span>{" "}
                                {analysisResult.unredactionStats.words_under_redactions || 0}
                              </div>
                              <div>
                                <span className="font-medium">Total Words in PDF:</span>{" "}
                                {analysisResult.unredactionStats.total_words_extracted || 0}
                              </div>
                              <div>
                                <span className="font-medium">Chars Recovered:</span>{" "}
                                {analysisResult.unredactionStats.chars_under_redactions || 0}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-green-50 dark:bg-green-950 p-3 rounded-lg border border-green-200 dark:border-green-800">
                          <p className="text-sm text-green-600 dark:text-green-400">
                            ✓ Unredacted PDF generated successfully
                          </p>
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1 opacity-80">
                            Shows revealed text alongside original redactions
                          </p>
                        </div>
                      )}
                      <div className="bg-muted p-3 rounded-lg text-sm break-all">
                        {analysisResult.unredactedPath}
                      </div>
                      <a
                        href={`/api/tools/download-unredacted?path=${encodeURIComponent(
                          analysisResult.unredactedPath
                        )}`}
                        download
                      >
                        <Button size="sm" className="w-full" variant="default">
                          <Download className="h-4 w-4 mr-2" />
                          Download Unredacted PDF
                        </Button>
                      </a>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No unredacted PDF available
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
        </div>
      )}

      {/* Info Box */}
        <Card className="bg-muted">
          <CardHeader>
              <CardTitle className="text-base">How it Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="font-medium">1. Redaction Audit:</span> Analyzes PDF structure
              to detect redaction methods (overlays, annotations, embedded text).
            </p>
            <p>
              <span className="font-medium">2. X-ray Detection:</span> Identifies poorly
              executed redactions where text may be hidden but recoverable.
            </p>
            <p>
              <span className="font-medium">3. Metadata Audit:</span> Extracts and displays all
              PDF metadata including author, creation date, software used, XMP data, and embedded files.
            </p>
            <p>
              <span className="font-medium">4. Text Extraction:</span> Extracts all available
              text from the PDF to a JSON file for detailed analysis.
            </p>
            <p>
              <span className="font-medium">5. Unredacted PDF:</span> Generates a new PDF showing
              revealed text alongside original redactions for visual comparison.
            </p>
            <p className="text-xs text-muted-foreground pt-2">
              All analysis runs locally on your machine. No data is sent to external servers.
            </p>
          </CardContent>
        </Card>
    </div>
  );
}


