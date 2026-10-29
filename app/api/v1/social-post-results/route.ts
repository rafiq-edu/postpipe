import { z } from "zod";
import { applyCursor, pageOf, parseListQuery } from "@/lib/api/pagination";
import { UuidSchema } from "@/lib/api/schemas/common";
import { withApi } from "@/lib/api/with-api";
import { createServiceClient } from "@/lib/db/client";
import { isApprovalLimited, loadApprovals } from "@/lib/db/queries/approvals";
import { serializeResult } from "@/lib/db/queries/social-posts";
import type { Platform } from "@/lib/platforms/types";

export const GET = withApi(async (ctx) => {
  const q = parseListQuery(
    new URL(ctx.req.url),
    z.object({
      post_id: UuidSchema.optional(),
      social_account_id: UuidSchema.optional(),
    }),
  );
  const db = await createServiceClient();
  let query = db
    .from("social_post_targets")
    .select("*, social_accounts!inner(platform)")
    .eq("org_id", ctx.orgId)
    .eq("mode", ctx.mode);
  if (q.post_id) query = query.eq("post_id", q.post_id);
  if (q.social_account_id)
    query = query.eq("social_account_id", q.social_account_id);
  const { data, error } = await applyCursor(query, q.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (error) throw error;
  const page = pageOf(data, q.limit);
  const approvals = await loadApprovals();
  return Response.json({
    data: page.data.map(({ social_accounts, ...row }) =>
      serializeResult(
        row,
        social_accounts.platform as Platform,
        isApprovalLimited(approvals[social_accounts.platform]),
      ),
    ),
    next_cursor: page.next_cursor,
  });
});
