import { z } from "zod";
import { parseListQuery } from "@/lib/api/pagination";
import {
  CreateSocialPostSchema,
  SocialPostStatusSchema,
} from "@/lib/api/schemas/social-posts";
import { parseBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import {
  insertPost,
  insertTargets,
  listPosts,
  serializePost,
} from "@/lib/db/queries/social-posts";
import { prepareCreate } from "@/lib/publish/validate";
import { emit } from "@/lib/webhooks/events";

export const POST = withApi(
  async (ctx) => {
    const input = parseBody(CreateSocialPostSchema, ctx.body);
    const { accounts, media, scheduledAt } = await prepareCreate(
      ctx.orgId,
      ctx.mode,
      input,
    );
    const post = await insertPost({
      org_id: ctx.orgId,
      mode: ctx.mode,
      external_id: input.external_id ?? null,
      caption: input.caption,
      media_ids: media.stored.map((m) => m.media_id),
      media: media.stored,
      social_account_ids: accounts.map((a) => a.id),
      platform_configurations: (input.platform_configurations ?? {}) as never,
      account_configurations: (input.account_configurations ?? []) as never,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      status: input.is_draft ? "draft" : "scheduled",
    });
    if (!input.is_draft) {
      await insertTargets(post, accounts, scheduledAt ?? new Date());
      await emit(ctx.orgId, ctx.mode, "social.post.created", {
        post_id: post.id,
        external_id: post.external_id,
        status: "scheduled",
        scheduled_at: post.scheduled_at,
        social_accounts: post.social_account_ids,
      });
    }
    return Response.json(serializePost(post), { status: 201 });
  },
  { idempotent: true },
);

export const GET = withApi(async (ctx) => {
  const q = parseListQuery(
    new URL(ctx.req.url),
    z.object({
      external_id: z.string().min(1).max(255).optional(),
      status: SocialPostStatusSchema.optional(),
    }),
  );
  const page = await listPosts(ctx.orgId, ctx.mode, q);
  return Response.json({
    data: page.data.map(serializePost),
    next_cursor: page.next_cursor,
  });
});
