import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as cfSign } from "@aws-sdk/cloudfront-signer";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "../api/errors";
import { createServiceClient } from "../db/client";
import { PublishError } from "../platforms/types";
import { getSecret } from "../secrets";

export const UPLOAD_URL_TTL_SECONDS = 900;
export const MAX_UPLOAD_BYTES = 1_073_741_824;

let client: S3Client | undefined;
export function s3Client(): S3Client {
  client ??= new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.AWS_ENDPOINT_URL
      ? { endpoint: process.env.AWS_ENDPOINT_URL, forcePathStyle: true }
      : {}),
  });
  return client;
}

export function bucket(): string {
  const b = process.env.MEDIA_BUCKET;
  if (!b)
    throw new Error("MEDIA_BUCKET is not set, see docs/ops/keys-registry.md");
  return b;
}

export const storageKey = (orgId: string, mode: string, mediaId: string) =>
  `${orgId}/${mode}/${mediaId}`;

export function presignPut(key: string, mime: string, bytes: number) {
  return getSignedUrl(
    s3Client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: mime,
      ContentLength: bytes,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export function presignGet(key: string, ttlSeconds: number) {
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: ttlSeconds },
  );
}

export async function headObject(
  key: string,
): Promise<{ bytes: number; mime: string }> {
  try {
    const out = await s3Client().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: key }),
    );
    return {
      bytes: out.ContentLength ?? 0,
      mime: out.ContentType ?? "application/octet-stream",
    };
  } catch (e) {
    const err = e as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound")
      throw new PublishError(
        "media_unreachable",
        "permanent",
        "media object missing",
      );
    throw new PublishError(
      "media_unreachable",
      "retryable",
      err.message ?? "S3 head failed",
    );
  }
}

/** Inclusive byte range. */
export async function getRange(
  key: string,
  start: number,
  end: number,
): Promise<Uint8Array> {
  const out = await s3Client().send(
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      Range: `bytes=${start}-${end}`,
    }),
  );
  if (!out.Body) throw new Error("S3 returned no body");
  return out.Body.transformToByteArray();
}

/** Whole object as a web stream, with the length S3 reports. */
export async function getObjectStream(
  key: string,
): Promise<{ body: ReadableStream; length: number | undefined }> {
  const out = await s3Client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  if (!out.Body) throw new Error("S3 returned no body");
  return {
    body: out.Body.transformToWebStream(),
    length: out.ContentLength,
  };
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
  );
}

export async function cloudfrontSignedUrl(
  url: string,
  ttlSeconds: number,
): Promise<string> {
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  if (!keyPairId) throw new Error("CLOUDFRONT_KEY_PAIR_ID is not set");
  return cfSign({
    url,
    keyPairId,
    privateKey: await getSecret("CLOUDFRONT_PRIVATE_KEY"),
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}

export async function createUploadUrl(
  orgId: string,
  mode: "live" | "test",
  input: { mime: string; bytes: number },
): Promise<{
  mediaId: string;
  uploadUrl: string;
  mediaUrl: string;
  expiresAt: string;
}> {
  if (input.bytes > MAX_UPLOAD_BYTES)
    throw new ApiError(
      422,
      "validation_failed",
      "bytes must be at most 1073741824",
    );
  const mediaId = randomUUID();
  const key = storageKey(orgId, mode, mediaId);
  const db = await createServiceClient();
  const { error } = await db.from("media").insert({
    id: mediaId,
    org_id: orgId,
    mode,
    storage_path: key,
    mime: input.mime,
    bytes: input.bytes,
    status: "uploaded",
  });
  if (error) throw error;
  return {
    mediaId,
    uploadUrl: await presignPut(key, input.mime, input.bytes),
    mediaUrl: `${process.env.NEXT_PUBLIC_APP_URL}/media/${mediaId}`,
    expiresAt: new Date(
      Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
    ).toISOString(),
  };
}

export async function getMediaRow(mediaId: string) {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("media")
    .select(
      "id, org_id, mode, storage_path, mime, bytes, width, height, duration_ms, status",
    )
    .eq("id", mediaId)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new PublishError("media_unreachable", "permanent", "media not found");
  return data;
}

export async function signedReadUrl(
  mediaId: string,
  ttlSeconds = 86_400,
): Promise<string> {
  const row = await getMediaRow(mediaId);
  if (process.env.CLOUDFRONT_KEY_PAIR_ID)
    return cloudfrontSignedUrl(
      `https://${process.env.MEDIA_CDN_HOST}/${row.storage_path}`,
      ttlSeconds,
    );
  return presignGet(row.storage_path, ttlSeconds);
}

export async function headMedia(mediaId: string) {
  return headObject((await getMediaRow(mediaId)).storage_path);
}

export async function fetchRange(
  mediaId: string,
  start: number,
  end: number,
): Promise<Uint8Array> {
  return getRange((await getMediaRow(mediaId)).storage_path, start, end);
}

export const deleteMediaObject = deleteObject;
