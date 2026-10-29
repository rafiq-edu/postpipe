import { generateApiKey } from "../../api/keys";
import { createServiceClient } from "../client";
import { createServerSupabase } from "../server";

export interface ApiKeyLookup {
  id: string;
  org_id: string;
  mode: "live" | "test";
  revoked_at: string | null;
}

export async function findApiKeyByHash(
  hash: string,
): Promise<ApiKeyLookup | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("api_keys")
    .select("id, org_id, mode, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error) throw error;
  return data as ApiKeyLookup | null;
}

export async function touchApiKey(id: string): Promise<void> {
  const db = await createServiceClient();
  await db
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id);
}

export async function createApiKey(
  orgId: string,
  mode: "live" | "test",
  name: string,
): Promise<{ id: string; plaintext: string; prefix: string; last4: string }> {
  const k = generateApiKey(mode);
  const db = await createServiceClient();
  const { data, error } = await db
    .from("api_keys")
    .insert({
      org_id: orgId,
      name,
      mode,
      key_hash: k.hash,
      key_prefix: k.prefix,
      last4: k.last4,
    })
    .select("id")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    plaintext: k.plaintext,
    prefix: k.prefix,
    last4: k.last4,
  };
}

export async function listApiKeys(orgId: string) {
  const db = await createServerSupabase();
  const { data, error } = await db
    .from("api_keys_public")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function revokeApiKey(orgId: string, id: string): Promise<void> {
  const db = await createServiceClient();
  const { error } = await db
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}
