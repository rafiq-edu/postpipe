import type { z } from "zod";
import { applyCursor, pageOf } from "../../api/pagination";
import type {
  SocialPostResultSchema,
  SocialPostSchema,
} from "../../api/schemas/social-posts";
import type { Platform } from "../../platforms/types";
import type { AccountForPublish, StoredMedia } from "../../publish/validate";
import { createServiceClient } from "../client";
import type { Tables, TablesInsert, TablesUpdate } from "../types";

export type SocialPostRow = Tables<"social_posts">;
export type TargetRow = Tables<"social_post_targets">;

export function serializePost(
  row: SocialPostRow,
): z.output<typeof SocialPostSchema> {
  return {
    id: row.id,
    external_id: row.external_id,
    caption: row.caption ?? "",
    media: (row.media as unknown as StoredMedia[]).map(
      ({ url, thumbnail_url, alt_text }) => ({
        url,
        ...(thumbnail_url ? { thumbnail_url } : {}),
        ...(alt_text !== undefined ? { alt_text } : {}),
      }),
    ),
    social_accounts: row.social_account_ids,
    scheduled_at: row.scheduled_at,
    status: row.status,
    platform_configurations: row.platform_configurations as Record<
      string,
      unknown
    >,
    account_configurations: row.account_configurations as z.output<
      typeof SocialPostSchema
    >["account_configurations"],
    is_draft: row.status === "draft",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializeResult(
  row: TargetRow,
  platform: Platform,
  approvalLimited: boolean,
): z.output<typeof SocialPostResultSchema> {
  return {
    id: row.id,
    post_id: row.post_id,
    social_account_id: row.social_account_id,
    platform,
    status: row.status,
    platform_post_id: row.platform_post_id,
    platform_post_url: row.platform_post_url,
    error_code: row.error_code,
    error_message: row.error_message,
    attempts: row.attempts,
    published_at: row.published_at,
    approval_limited: approvalLimited,
  };
}

export async function insertPost(
  fields: TablesInsert<"social_posts">,
): Promise<SocialPostRow> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_posts")
    .insert(fields)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePost(
  id: string,
  fields: TablesUpdate<"social_posts">,
): Promise<SocialPostRow> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_posts")
    .update(fields)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPost(
  orgId: string,
  mode: "live" | "test",
  id: string,
): Promise<SocialPostRow | null> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_posts")
    .select("*")
    .eq("org_id", orgId)
    .eq("mode", mode)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPosts(
  orgId: string,
  mode: "live" | "test",
  q: {
    limit: number;
    cursor?: string;
    external_id?: string;
    status?: SocialPostRow["status"];
  },
): Promise<{ data: SocialPostRow[]; next_cursor: string | null }> {
  const db = await createServiceClient();
  let query = db
    .from("social_posts")
    .select("*")
    .eq("org_id", orgId)
    .eq("mode", mode);
  if (q.external_id) query = query.eq("external_id", q.external_id);
  if (q.status) query = query.eq("status", q.status);
  const { data, error } = await applyCursor(query, q.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (error) throw error;
  return pageOf(data, q.limit);
}

export async function targetsOf(
  postId: string,
): Promise<Pick<TargetRow, "id" | "status">[]> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_post_targets")
    .select("id, status")
    .eq("post_id", postId);
  if (error) throw error;
  return data;
}

export async function insertTargets(
  post: SocialPostRow,
  accounts: AccountForPublish[],
  nextAttemptAt: Date,
): Promise<void> {
  const db = await createServiceClient();
  const { error } = await db.from("social_post_targets").insert(
    accounts.map((a) => ({
      org_id: post.org_id,
      mode: post.mode,
      post_id: post.id,
      social_account_id: a.id,
      platform: a.platform,
      status: "pending" as const,
      next_attempt_at: nextAttemptAt.toISOString(),
    })),
  );
  if (error) throw error;
}

export async function cancelPendingTargets(postId: string): Promise<number> {
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_post_targets")
    .update({ status: "cancelled" })
    .eq("post_id", postId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return data.length;
}
