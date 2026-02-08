import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import pLimit from "p-limit";
import { db } from "../../server/db";
import { documents } from "../../shared/schema";
import { and, isNull, isNotNull, inArray, eq } from "drizzle-orm";
import { isR2Configured, uploadToR2, existsInR2, buildR2Key } from "../../server/r2";

const __filename = fileURLToPath(import.meta.url);

interface MigrationResult {
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  totalBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function migrateToR2(options: {
  dataSetIds?: number[];
  concurrency?: number;
  dryRun?: boolean;
} = {}): Promise<MigrationResult> {
  const { dataSetIds, concurrency = 5, dryRun = false } = options;

  console.log("\n=== R2 Migration ===\n");

  if (!isR2Configured()) {
    console.log("R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.");
    return { total: 0, uploaded: 0, skipped: 0, failed: 0, totalBytes: 0 };
  }

  // Query documents with local files but no R2 key
  const conditions = [isNotNull(documents.localPath), isNotNull(documents.dataSet), isNull(documents.r2Key)];
  if (dataSetIds?.length) {
    conditions.push(inArray(documents.dataSet, dataSetIds.map(String)));
  }

  const docs = await db
    .select({
      id: documents.id,
      localPath: documents.localPath,
      dataSet: documents.dataSet,
      mimeType: documents.mimeType,
      fileSizeBytes: documents.fileSizeBytes,
    })
    .from(documents)
    .where(and(...conditions));

  console.log(`Documents to migrate: ${docs.length}`);
  console.log(`Concurrency:          ${concurrency}`);
  console.log(`Dry run:              ${dryRun}\n`);

  if (docs.length === 0) {
    console.log("Nothing to migrate.");
    return { total: 0, uploaded: 0, skipped: 0, failed: 0, totalBytes: 0 };
  }

  const result: MigrationResult = { total: docs.length, uploaded: 0, skipped: 0, failed: 0, totalBytes: 0 };
  const limit = pLimit(concurrency);
  const startTime = Date.now();

  const tasks = docs.map((doc) =>
    limit(async () => {
      const localPath = doc.localPath!;
      const r2Key = buildR2Key(doc.dataSet!, `${doc.id}-${path.basename(localPath)}`);

      try {
        // Check if file exists locally
        if (!fs.existsSync(localPath)) {
          console.warn(`  Skip (missing): ${localPath}`);
          result.skipped++;
          return;
        }

        // Idempotency: check if already in R2
        if (await existsInR2(r2Key)) {
          // Already uploaded — just update DB
          await db.update(documents).set({ r2Key }).where(eq(documents.id, doc.id));
          console.log(`  Already in R2: ${r2Key} (DB updated)`);
          result.skipped++;
          return;
        }

        if (dryRun) {
          const size = doc.fileSizeBytes || fs.statSync(localPath).size;
          console.log(`  Would upload: ${r2Key} (${formatBytes(size)})`);
          result.skipped++;
          return;
        }

        // Upload using stream to avoid loading entire file into memory
        const fileSize = doc.fileSizeBytes || fs.statSync(localPath).size;
        await uploadToR2(r2Key, fs.createReadStream(localPath), doc.mimeType || "application/pdf");
        await db.update(documents).set({ r2Key }).where(eq(documents.id, doc.id));

        result.uploaded++;
        result.totalBytes += fileSize;
        console.log(`  Uploaded: ${r2Key} (${formatBytes(fileSize)})`);
      } catch (err: unknown) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  Failed: ${r2Key} — ${msg}`);
      }

      // Progress logging every 10 documents
      const processed = result.uploaded + result.skipped + result.failed;
      if (processed % 10 === 0 && processed > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(
          `\n  Progress: ${processed}/${docs.length} processed, ` +
            `${result.uploaded} uploaded, ${formatBytes(result.totalBytes)} | ${elapsed.toFixed(1)}s\n`,
        );
      }
    }),
  );

  await Promise.all(tasks);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== Migration Summary ===");
  console.log(`Uploaded:   ${result.uploaded}`);
  console.log(`Skipped:    ${result.skipped}`);
  console.log(`Failed:     ${result.failed}`);
  console.log(`Total size: ${formatBytes(result.totalBytes)}`);
  console.log(`Time:       ${elapsed}s`);

  return result;
}

// CLI entry point
if (process.argv[1]?.includes(path.basename(__filename))) {
  const args = process.argv.slice(2);
  const options: Parameters<typeof migrateToR2>[0] = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data-sets" && args[i + 1]) {
      options.dataSetIds = args[++i].split(",").map(Number);
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      options.concurrency = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    }
  }

  migrateToR2(options)
    .then((result) => {
      console.log(`\nDone: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.failed} failed`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
