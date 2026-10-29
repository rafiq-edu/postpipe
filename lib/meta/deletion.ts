import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";

export const META_PLATFORMS = ["instagram", "facebook", "threads"] as const;

export async function deleteMetaUser(
  db: SupabaseClient<Database>,
  platformUserId: string,
): Promise<{ confirmationCode: string; deleted: number }> {
  const { data, error } = await db
    .from("social_accounts")
    .select("id")
    .in("platform", [...META_PLATFORMS])
    .eq("platform_user_id", platformUserId);
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) {
    const { error: e } = await db
      .from("social_accounts")
      .delete()
      .in("id", ids);
    if (e) throw e;
  }
  const confirmationCode = randomBytes(8).toString("hex");
  const { error: e2 } = await db.from("meta_deletion_requests").insert({
    confirmation_code: confirmationCode,
    platform_user_id: platformUserId,
    status: "completed",
  });
  if (e2) throw e2;
  return { confirmationCode, deleted: ids.length };
}

export async function revokeMetaUser(
  db: SupabaseClient<Database>,
  platformUserId: string,
): Promise<number> {
  const { data, error } = await db
    .from("social_accounts")
    .update({ status: "revoked" })
    .in("platform", [...META_PLATFORMS])
    .eq("platform_user_id", platformUserId)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function getDeletionRequest(
  db: SupabaseClient<Database>,
  code: string,
): Promise<{ status: string; created_at: string } | null> {
  const { data, error } = await db
    .from("meta_deletion_requests")
    .select("status, created_at")
    .eq("confirmation_code", code)
    .maybeSingle();
  if (error) throw error;
  return data;
}
