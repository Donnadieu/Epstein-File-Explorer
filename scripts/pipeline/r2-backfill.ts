import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import pLimit from "p-limit";
import { db } from "../../server/db";
import { documents } from "../../shared/schema";
import { sql, isNull, isNotNull } from "drizzle-orm";
import { isR2Configured, uploadToR2, buildR2Key } from "../../server/r2";

const CONCURRENCY = 5;

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
};

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  return MIME_MAP[ext] || "application/octet-stream";
}

async function main() {
  console.log("\n=== R2 Backfill: Upload Existing Downloads ===\n");

  if (!isR2Configured()) {
    console.error("R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME in .env");
    process.exit(1);
  }

  // Find documents with local_path but no r2_key
  const rows = await db
    .select({
      id: documents.id,
      localPath: documents.localPath,
      dataSet: documents.dataSet,
      sourceUrl: documents.sourceUrl,
    })
    .from(documents)
    .where(sql`${documents.localPath} IS NOT NULL AND ${documents.r2Key} IS NULL`);

  console.log(`Found ${rows.length} documents with local files but no R2 key\n`);

  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const limit = pLimit(CONCURRENCY);
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  const tasks = rows.map((row) =>
    limit(async () => {
      const localPath = row.localPath!;

      if (!fs.existsSync(localPath)) {
        skipped++;
        return;
      }

      const filename = path.basename(localPath);
      // Extract data set ID from the data_set field (e.g., "Data Set 11" → 11)
      const dsMatch = row.dataSet?.match(/(\d+)/);
      const dsId = dsMatch ? dsMatch[1] : "unknown";

      try {
        const r2Key = buildR2Key(dsId, filename);
        const fileBuffer = fs.readFileSync(localPath);
        const mime = guessMime(localPath);

        await uploadToR2(r2Key, fileBuffer, mime);

        await db
          .update(documents)
          .set({ r2Key })
          .where(sql`${documents.id} = ${row.id}`);

        uploaded++;

        if (uploaded % 50 === 0) {
          console.log(`  Progress: ${uploaded}/${rows.length} uploaded, ${skipped} skipped, ${failed} failed`);
        }
      } catch (err: any) {
        failed++;
        console.warn(`  Failed ${filename}: ${err.message}`);
      }
    })
  );

  await Promise.all(tasks);

  console.log("\n=== Backfill Summary ===");
  console.log(`Uploaded:  ${uploaded}`);
  console.log(`Skipped:   ${skipped} (file not found locally)`);
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${rows.length}`);
}

main().catch(console.error);
