import { ApiError } from "@/lib/api/errors";
import { UuidSchema } from "@/lib/api/schemas/common";
import {
  CreateSocialPostBaseSchema,
  CreateSocialPostSchema,
} from "@/lib/api/schemas/social-posts";
import { parseBody } from "@/lib/api/validate";
import { type ApiContext, withApi } from "@/lib/api/with-api";
import {
  cancelPendingTargets,
  getPost,
  insertTargets,
  type SocialPostRow,
  serializePost,
  targetsOf,
  updatePost,
} from "@/lib/db/queries/social-posts";
import { prepareCreate, type StoredMedia } from "@/lib/publish/validate";
import { emit } from "@/lib/webhooks/events";

const locked = () =>
  new ApiError(
    409,
    "post_locked",
    "Post is publishing or finished and can no longer be changed",
  );

async function load(ctx: ApiContext): Promise<SocialPostRow> {
  const id = UuidSchema.safeParse(ctx.params.id);
  const post = id.success ? await getPost(ctx.orgId, ctx.mode, id.data) : null;
  if (!post) throw new ApiError(404, "not_found", "Post not found");
  return post;
}

function assertEditable(
  post: SocialPostRow,
  targets: { status: string }[],
): number {
  if (
    (post.status !== "draft" && post.status !== "scheduled") ||
    targets.some((t) => t.status !== "pending" && t.status !== "cancelled")
  )
    throw locked();
  return targets.filter((t) => t.status === "pending").length;
}

export const GET = withApi(async (ctx) =>
  Response.json(serializePost(await load(ctx))),
);

export const PATCH = withApi(
  async (ctx) => {
    const parsed = parseBody(CreateSocialPostBaseSchema.partial(), ctx.body);
    // Zod 4 applies defaults inside .partial(); keep only keys the client sent.
    const sent = (ctx.body ?? {}) as Record<string, unknown>;
    const patch: typeof parsed = Object.fromEntries(
      Object.entries(parsed).filter(([k]) => k in sent),
    );
    const post = await load(ctx);
    const pendingCount = assertEditable(post, await targetsOf(post.id));
    const merged = {
      caption: patch.caption ?? post.caption ?? "",
      media:
        patch.media ??
        (post.media as unknown as StoredMedia[]).map(
          ({ url, thumbnail_url, alt_text }) => ({
            url,
            thumbnail_url,
            alt_text,
          }),
        ),
      social_accounts: patch.social_accounts ?? post.social_account_ids,
      platform_configurations:
        patch.platform_configurations ?? post.platform_configurations,
      account_configurations:
        patch.account_configurations ?? post.account_configurations,
      external_id: patch.external_id ?? post.external_id ?? undefined,
      is_draft: patch.is_draft ?? post.status === "draft",
      ...(patch.scheduled_at !== undefined
        ? { scheduled_at: patch.scheduled_at }
        : {}),
    };
    const full = parseBody(CreateSocialPostSchema, merged);
    const scheduledIso = patch.scheduled_at ?? post.scheduled_at;
    const { accounts, media } = await prepareCreate(ctx.orgId, ctx.mode, {
      ...full,
      scheduled_at: scheduledIso ?? undefined,
    });
    const scheduledAt = scheduledIso ? new Date(scheduledIso) : null;
    if ((await cancelPendingTargets(post.id)) !== pendingCount) throw locked();
    const now = new Date();
    const updated = await updatePost(post.id, {
      caption: full.caption,
      media_ids: media.stored.map((m) => m.media_id),
      media: media.stored,
      social_account_ids: accounts.map((a) => a.id),
      platform_configurations: (full.platform_configurations ?? {}) as never,
      account_configurations: (full.account_configurations ?? []) as never,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      external_id: full.external_id ?? null,
      status: full.is_draft ? "draft" : "scheduled",
      updated_at: now.toISOString(),
    });
    if (!full.is_draft) {
      await insertTargets(updated, accounts, scheduledAt ?? now);
      if (post.status === "draft")
        await emit(ctx.orgId, ctx.mode, "social.post.created", {
          post_id: updated.id,
          external_id: updated.external_id,
          status: "scheduled",
          scheduled_at: updated.scheduled_at,
          social_accounts: updated.social_account_ids,
        });
    }
    return Response.json(serializePost(updated));
  },
  { idempotent: true },
);

export const DELETE = withApi(async (ctx) => {
  const post = await load(ctx);
  if (post.status === "cancelled") return new Response(null, { status: 204 });
  const pendingCount = assertEditable(post, await targetsOf(post.id));
  if ((await cancelPendingTargets(post.id)) !== pendingCount) throw locked();
  await updatePost(post.id, {
    status: "cancelled",
    updated_at: new Date().toISOString(),
  });
  return new Response(null, { status: 204 });
});
