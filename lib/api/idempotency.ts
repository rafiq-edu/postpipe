import { createHash } from "node:crypto";
import { decryptToken, encryptToken } from "../crypto/tokens";
import { createServiceClient } from "../db/client";

export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function requestHash(
  method: string,
  path: string,
  mode: string,
  rawBody: string,
): string {
  return createHash("sha256")
    .update(`${method}\n${path}\n${mode}\n${rawBody}`)
    .digest("hex");
}

export async function findIdempotent(
  orgId: string,
  key: string,
): Promise<{
  request_hash: string;
  response: StoredResponse | null;
  expires_at: string;
} | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("idempotency_keys")
    .select("request_hash, response, expires_at")
    .eq("org_id", orgId)
    .eq("key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const response = data.response as unknown as StoredResponse | null;
  return {
    request_hash: data.request_hash,
    expires_at: data.expires_at,
    response: response && {
      ...response,
      body: await decryptToken(response.body),
    },
  };
}

// Claims (org, key) before the handler runs. True = we own it.
export async function reserveIdempotent(
  orgId: string,
  key: string,
  hash: string,
): Promise<boolean> {
  const db = await createServiceClient();
  const now = new Date();
  await db
    .from("idempotency_keys")
    .delete()
    .eq("org_id", orgId)
    .eq("key", key)
    .lte("expires_at", now.toISOString());
  const { data, error } = await db
    .from("idempotency_keys")
    .upsert(
      {
        org_id: orgId,
        key,
        request_hash: hash,
        response: null,
        expires_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
      },
      { onConflict: "org_id,key", ignoreDuplicates: true },
    )
    .select("key");
  if (error) throw error;
  return data.length > 0;
}

// Drops our own unfinished reservation (handler failed).
export async function releaseIdempotent(
  orgId: string,
  key: string,
  hash: string,
): Promise<void> {
  const db = await createServiceClient();
  await db
    .from("idempotency_keys")
    .delete()
    .eq("org_id", orgId)
    .eq("key", key)
    .eq("request_hash", hash)
    .is("response", null);
}

export async function storeIdempotent(
  orgId: string,
  key: string,
  hash: string,
  response: StoredResponse,
): Promise<void> {
  const db = await createServiceClient();
  const { error } = await db
    .from("idempotency_keys")
    .update({
      response: {
        ...response,
        body: await encryptToken(response.body),
      } as unknown as import("../db/types").Json,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    })
    .eq("org_id", orgId)
    .eq("key", key)
    .eq("request_hash", hash);
  if (error) throw error;
}
