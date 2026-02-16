/**
 * Python Tools Bridge
 *
 * Orchestrates interactions with Python CLI tools:
 * - tools/unredact-main/redaction_audit.py
 * - tools/unredact-main/redact_extract.py
 * - tools/x-ray-main/xray (via python -m xray)
 *
 * All tools are spawned as child processes with full error handling.
 * Designed for integration with Express routes and background workers.
 */

import { execFile, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

// ESM-compatible __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Path to Python tools
const TOOLS_DIR = path.join(PROJECT_ROOT, "tools");
const UNREDACT_DIR = path.join(TOOLS_DIR, "unredact-main");
const XRAY_DIR = path.join(TOOLS_DIR, "x-ray-main");

/**
 * Get environment variables for Python processes
 * Ensures PYTHONPATH includes xray module directory
 */
function getPythonEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const currentPythonPath = env.PYTHONPATH || "";
  env.PYTHONPATH = currentPythonPath
    ? `${XRAY_DIR}:${currentPythonPath}`
    : XRAY_DIR;
  return env;
}

/**
 * Verify Python tools are installed and ready
 */
export function verifyPythonToolsSetup(): {
  ready: boolean;
  errors: string[];
  details: Record<string, unknown>;
} {
  const errors: string[] = [];
  const details: Record<string, unknown> = {};

  // Check Python availability
  const pythonCheck = spawnSync("python3", ["--version"], {
    encoding: "utf-8",
  });
  if (pythonCheck.error) {
    errors.push(
      `Python3 not found: ${pythonCheck.error.message}. Install Python 3.10+ and ensure it's in PATH.`
    );
    return { ready: false, errors, details };
  }
  details.pythonVersion = pythonCheck.stdout?.trim() || pythonCheck.stderr;

  // Check unredact dependencies
  const unredactCheck = spawnSync(
    "python3",
    [
      "-c",
      "import pdfplumber, fitz; print('OK')",
    ],
    { encoding: "utf-8", cwd: UNREDACT_DIR }
  );
  if (unredactCheck.status !== 0) {
    errors.push(
      `Unredact dependencies not installed. Run: npm run setup-python`
    );
  } else {
    details.unredactReady = unredactCheck.stdout?.trim() === "OK";
  }

  // Check xray dependencies
  const xrayCheck = spawnSync("python3", ["-c", "import xray; print('OK')"], {
    encoding: "utf-8",
    env: getPythonEnv(),
  });
  if (xrayCheck.status !== 0) {
    errors.push(
      `X-ray dependencies not installed. Run: npm run setup-python`
    );
  } else {
    details.xrayReady = xrayCheck.stdout?.trim() === "OK";
  }

  return {
    ready: errors.length === 0,
    errors,
    details,
  };
}

/**
 * Run redaction audit on a PDF file
 * Returns JSON output from redaction_audit.py
 */
export async function runRedactionAudit(pdfPath: string): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  stderr?: string;
}> {
  return new Promise((resolve) => {
    const scriptPath = path.join(UNREDACT_DIR, "redaction_audit.py");

    if (!existsSync(scriptPath)) {
      return resolve({
        success: false,
        error: `Script not found: ${scriptPath}`,
      });
    }

    if (!existsSync(pdfPath)) {
      return resolve({
        success: false,
        error: `PDF file not found: ${pdfPath}`,
      });
    }

    let stdout = "";
    let stderr = "";

    const proc = execFile(
      "python3",
      [scriptPath, pdfPath],
      { cwd: UNREDACT_DIR, maxBuffer: 10 * 1024 * 1024 }, // 10MB buffer for large PDFs
      (error, out, err) => {
        stdout = out;
        stderr = err;

        if (error) {
          console.error(
            `[redaction_audit] Error processing ${pdfPath}:`,
            error.message
          );
          return resolve({
            success: false,
            error: error.message,
            stderr,
          });
        }

        try {
          // The script writes to reports/{filename}.redaction_audit.json
          const baseDir = path.dirname(pdfPath);
          const pdfName = path.basename(pdfPath, path.extname(pdfPath));
          const reportPath = path.join(
            UNREDACT_DIR,
            "reports",
            `${pdfName}.redaction_audit.json`
          );

          // Wait a moment for the file to be written
          setTimeout(() => {
            try {
              if (!existsSync(reportPath)) {
                return resolve({
                  success: false,
                  error: `Report file not generated: ${reportPath}`,
                  stderr: stdout,
                });
              }

              const reportData = readFileSync(reportPath, "utf-8");
              const data = JSON.parse(reportData);
              resolve({ success: true, data });
            } catch (readError) {
              resolve({
                success: false,
                error: `Failed to read report: ${readError}`,
                stderr: stdout,
              });
            }
          }, 100);
        } catch (parseError) {
          resolve({
            success: false,
            error: `Failed to process audit output: ${parseError}`,
            stderr: stdout,
          });
        }
      }
    );

    // Timeout protection
    proc.on("error", (err) => {
      resolve({ success: false, error: err.message, stderr });
    });
  });
}

/**
 * Run x-ray analysis on a PDF to detect bad redactions
 * Returns JSON output
 */
export async function runXrayAnalysis(pdfPath: string): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  stderr?: string;
}> {
  return new Promise((resolve) => {
    if (!existsSync(pdfPath)) {
      return resolve({
        success: false,
        error: `PDF file not found: ${pdfPath}`,
      });
    }

    let stdout = "";
    let stderr = "";

    const proc = execFile(
      "python3",
      ["-m", "xray", pdfPath],
      { cwd: XRAY_DIR, maxBuffer: 10 * 1024 * 1024, env: getPythonEnv() },
      (error, out, err) => {
        stdout = out;
        stderr = err;

        if (error) {
          // X-ray may exit with status 0 even with errors; check stderr
          if (err && err.includes("error")) {
            return resolve({
              success: false,
              error: err,
              stderr,
            });
          }
        }

        try {
          const data = JSON.parse(stdout || "{}");
          resolve({ success: true, data });
        } catch (parseError) {
          resolve({
            success: false,
            error: `Failed to parse x-ray output: ${parseError}`,
            stderr: stdout,
          });
        }
      }
    );

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message, stderr });
    });
  });
}

/**
 * Extract comprehensive metadata from a PDF file
 * Returns document info, XMP metadata, file properties, embedded files, etc.
 */
export async function extractMetadata(pdfPath: string): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  stderr?: string;
}> {
  return new Promise((resolve) => {
    const scriptPath = path.join(UNREDACT_DIR, "metadata_extract.py");

    if (!existsSync(scriptPath)) {
      return resolve({
        success: false,
        error: `Script not found: ${scriptPath}`,
      });
    }

    if (!existsSync(pdfPath)) {
      return resolve({
        success: false,
        error: `PDF file not found: ${pdfPath}`,
      });
    }

    let stdout = "";
    let stderr = "";

    const proc = execFile(
      "python3",
      [scriptPath, pdfPath],
      { cwd: UNREDACT_DIR, maxBuffer: 10 * 1024 * 1024 },
      (error, out, err) => {
        stdout = out;
        stderr = err;

        if (error) {
          return resolve({
            success: false,
            error: error.message,
            stderr,
          });
        }

        try {
          const data = JSON.parse(stdout);
          resolve({ success: true, data });
        } catch (parseError) {
          resolve({
            success: false,
            error: `Failed to parse metadata output: ${parseError}`,
            stderr: stdout,
          });
        }
      }
    );

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message, stderr });
    });
  });
}

/**
 * Generate unredacted PDF by removing redaction overlays and revealing text
 * Creates a side-by-side or overlay version with statistics
 */
export async function generateUnredactedPDF(
  pdfPath: string,
  mode: "side_by_side" | "overlay_white" = "side_by_side"
): Promise<{
  success: boolean;
  outputPath?: string;
  statsPath?: string;
  stats?: Record<string, unknown>;
  error?: string;
  stderr?: string;
}> {
  return new Promise((resolve) => {
    const scriptPath = path.join(UNREDACT_DIR, "redact_extract.py");

    if (!existsSync(scriptPath)) {
      return resolve({
        success: false,
        error: `Script not found: ${scriptPath}`,
      });
    }

    if (!existsSync(pdfPath)) {
      return resolve({
        success: false,
        error: `PDF file not found: ${pdfPath}`,
      });
    }

    // Generate output paths in /tmp directory
    const baseDir = path.join(os.tmpdir(), "epstein-pdf-unredacted");
    if (!existsSync(baseDir)) {
      fsSync.mkdirSync(baseDir, { recursive: true });
    }
    
    const pdfName = path.basename(pdfPath, path.extname(pdfPath));
    const timestamp = Date.now();
    const suffix = mode === "side_by_side" ? "_side_by_side.pdf" : "_overlay_white.pdf";
    const outputPath = path.join(baseDir, `${pdfName}_${timestamp}${suffix}`);
    const statsPath = path.join(baseDir, `${pdfName}_${timestamp}_stats.json`);

    let stderr = "";

    const proc = execFile(
      "python3",
      [scriptPath, pdfPath, "-o", outputPath, "--mode", mode, "--stats-json", statsPath],
      { cwd: UNREDACT_DIR, maxBuffer: 50 * 1024 * 1024 }, // 50MB for large PDFs
      (error, _out, err) => {
        stderr = err;

        if (error) {
          return resolve({
            success: false,
            error: error.message,
            stderr,
          });
        }

        // Verify the output file was created
        if (!existsSync(outputPath)) {
          return resolve({
            success: false,
            error: "Output PDF was not created",
            stderr,
          });
        }

        // Read stats if available
        let stats: Record<string, unknown> | undefined;
        if (existsSync(statsPath)) {
          try {
            const statsContent = readFileSync(statsPath, "utf-8");
            stats = JSON.parse(statsContent);
          } catch (parseError) {
            console.error("[Unredact] Failed to parse stats:", parseError);
          }
        }

        resolve({
          success: true,
          outputPath,
          statsPath,
          stats,
          stderr: stderr || undefined,
        });
      }
    );

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message, stderr });
    });
  });
}

/**
 * Run text extraction (unredact) on a PDF
 * Outputs to a JSON file with extracted text data
 */
export async function runTextExtraction(
  pdfPath: string,
  outputPath?: string
): Promise<{
  success: boolean;
  outputPath?: string;
  error?: string;
  stderr?: string;
}> {
  return new Promise((resolve) => {
    const scriptPath = path.join(UNREDACT_DIR, "redact_extract.py");

    if (!existsSync(scriptPath)) {
      return resolve({
        success: false,
        error: `Script not found: ${scriptPath}`,
      });
    }

    if (!existsSync(pdfPath)) {
      return resolve({
        success: false,
        error: `PDF file not found: ${pdfPath}`,
      });
    }

    const args = [scriptPath, pdfPath];
    if (outputPath) {
      args.push("-o", outputPath);
    }

    let stderr = "";

    const proc = execFile(
      "python3",
      args,
      { cwd: UNREDACT_DIR, maxBuffer: 10 * 1024 * 1024 },
      (error, _out, err) => {
        stderr = err;

        if (error) {
          return resolve({
            success: false,
            error: error.message,
            stderr,
          });
        }

        resolve({
          success: true,
          outputPath: outputPath || `${pdfPath}.extracted.json`,
          stderr: stderr || undefined,
        });
      }
    );

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message, stderr });
    });
  });
}

/**
 * Run comprehensive PDF analysis pipeline:
 * 1. Redaction audit
 * 2. X-ray detection
 * 3. (Optional) Text extraction
 */
export async function analyzePDF(
  pdfPath: string,
  options?: {
    extract?: boolean;
    extractOutputPath?: string;
    generateUnredacted?: boolean;
  }
): Promise<{
  success: boolean;
  pdfPath: string;
  audit?: Record<string, unknown>;
  xray?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  extractedPath?: string;
  extractedText?: Record<string, unknown>;
  unredactedPath?: string;
  unredactionStats?: Record<string, unknown>;
  errors: string[];
}> {
  const errors: string[] = [];

  if (!existsSync(pdfPath)) {
    return {
      success: false,
      pdfPath,
      errors: [`PDF not found: ${pdfPath}`],
    };
  }

  const results: {
    success: boolean;
    pdfPath: string;
    audit?: Record<string, unknown>;
    xray?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    extractedPath?: string;
    extractedText?: Record<string, unknown>;
    unredactedPath?: string;
    unredactionStats?: Record<string, unknown>;
    errors: string[];
  } = {
    success: true,
    pdfPath,
    errors,
  };

  // Run redaction audit
  const auditResult = await runRedactionAudit(pdfPath);
  if (auditResult.success && auditResult.data) {
    results.audit = auditResult.data;
  } else if (auditResult.error) {
    results.errors.push(`Audit failed: ${auditResult.error}`);
    results.success = false;
  }

  // Run x-ray analysis
  const xrayResult = await runXrayAnalysis(pdfPath);
  if (xrayResult.success && xrayResult.data) {
    results.xray = xrayResult.data;
  } else if (xrayResult.error) {
    results.errors.push(`X-ray failed: ${xrayResult.error}`);
    results.success = false;
  }

  // Extract metadata
  const metadataResult = await extractMetadata(pdfPath);
  if (metadataResult.success && metadataResult.data) {
    results.metadata = metadataResult.data;
  } else if (metadataResult.error) {
    results.errors.push(`Metadata extraction failed: ${metadataResult.error}`);
    // Don't fail the whole analysis if metadata extraction fails
  }

  // Run text extraction (always do this for comprehensive analysis)
  const extractResult = await runTextExtraction(pdfPath, options?.extractOutputPath);
  if (extractResult.success) {
    results.extractedPath = extractResult.outputPath;
    
    // Read extracted text file and include in response
    if (results.extractedPath && existsSync(results.extractedPath)) {
      try {
        const extractedContent = readFileSync(results.extractedPath, "utf-8");
        results.extractedText = JSON.parse(extractedContent);
      } catch (readError) {
        console.error(`[PDF Analysis] Failed to read extracted text:`, readError);
        // Don't fail, just skip the extracted text
      }
    }
  } else if (extractResult.error) {
    results.errors.push(`Extraction failed: ${extractResult.error}`);
    // Don't set success to false - extraction is bonus, audit matters more
  }

  // Generate unredacted PDF (always do this)
  const unredactResult = await generateUnredactedPDF(pdfPath, "side_by_side");
  if (unredactResult.success) {
    results.unredactedPath = unredactResult.outputPath;
    results.unredactionStats = unredactResult.stats;
  } else if (unredactResult.error) {
    results.errors.push(`Unredact generation failed: ${unredactResult.error}`);
    // Don't set success to false - this is bonus feature
  }

  return results;
}

export default {
  verifyPythonToolsSetup,
  runRedactionAudit,
  runXrayAnalysis,
  runTextExtraction,
  extractMetadata,
  generateUnredactedPDF,
  analyzePDF,
};
