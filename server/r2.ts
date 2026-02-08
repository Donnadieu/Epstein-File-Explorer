import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";

let _client: S3Client | null = null;

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function getClient(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.",
    );
  }
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _client;
}

function getBucket(): string {
  return process.env.R2_BUCKET_NAME!;
}

export function buildR2Key(dataSetId: string | number, filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `data-set-${dataSetId}/${sanitized}`;
  if (key.includes("..") || key.length > 512) {
    throw new Error(`Invalid R2 key: ${key}`);
  }
  return key;
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string = "application/pdf",
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getPresignedUrl(
  key: string,
  expiresIn: number = 3600,
): Promise<string> {
  const clamped = Math.max(60, Math.min(expiresIn, 7200));
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn: clamped },
  );
}

export async function getR2Stream(key: string): Promise<{
  body: Readable;
  contentType?: string;
  contentLength?: number;
}> {
  const resp = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  );
  return {
    body: resp.Body as unknown as Readable,
    contentType: resp.ContentType,
    contentLength: resp.ContentLength,
  };
}

export async function existsInR2(key: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key }),
    );
    return true;
  } catch (err: unknown) {
    const s3Err = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (s3Err.name === "NotFound" || s3Err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}
