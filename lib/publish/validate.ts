import type { z } from "zod";
import { ApiError } from "../api/errors";
import type {
  CreateSocialPostSchema,
  MediaItemSchema,
} from "../api/schemas/social-posts";
import { checkPlanAllows } from "../billing/usage";
import { PICKED_OR } from "../connect/unpicked";
import { createServiceClient } from "../db/client";
import type { SocialAccountRow } from "../db/queries/social-accounts";
import { probeMedia } from "../media/probe";
import { getMediaRow } from "../media/s3";
import { adapterFor } from "../platforms/registry";
import {
  type Json,
  type MediaInfo,
  type Platform,
  PublishError,
  type RuleViolation,
} from "../platforms/types";
import { precheck } from "./quotas";

type MediaItem = z.output<typeof MediaItemSchema>;

export type AccountForPublish = Pick<
  SocialAccountRow,
  | "id"
  | "org_id"
  | "mode"
  | "platform"
  | "external_id"
  | "platform_user_id"
  | "status"
  | "platform_data"
  | "deleted_at"
>;

export async function resolveAccounts(
  orgId: string,
  mode: "live" | "test",
  ids: string[],
): Promise<AccountForPublish[]> {
  const uniq = [...new Set(ids)];
  const db = await createServiceClient();
  const { data, error } = await db
    .from("social_accounts")
    .select(
      "id, org_id, mode, platform, external_id, platform_user_id, status, platform_data, deleted_at",
    )
    .in("id", uniq)
    .eq("org_id", orgId)
    .eq("mode", mode)
    .is("deleted_at", null)
    .or(PICKED_OR);
  if (error) throw error;
  const byId = new Map(data.map((a) => [a.id, a]));
  const missing = uniq.filter((id) => !byId.has(id));
  if (missing.length)
    throw new ApiError(
      422,
      "unknown_social_account",
      "Unknown social account",
      {
        social_account_ids: missing,
      },
    );
  const rows = uniq.map((id) => byId.get(id) as AccountForPublish);
  const bad = rows.filter((a) => a.status !== "connected").map((a) => a.id);
  if (bad.length)
    throw new ApiError(
      422,
      "account_reauth_required",
      "Social account must be reconnected",
      { social_account_ids: bad },
    );
  return rows;
}

const MEDIA_PATH =
  /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Host is not checked; the row lookup is org-scoped.
export function mediaIdFromUrl(url: string): string | null {
  try {
    return MEDIA_PATH.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

// type alias (not interface) so it is assignable to the Json column type
export type StoredMedia = {
  media_id: string;
  url: string;
  thumbnail_url?: string;
  alt_text?: string;
};

export async function resolveMedia(
  orgId: string,
  mode: "live" | "test",
  items: MediaItem[],
): Promise<{ infos: MediaInfo[]; stored: StoredMedia[] }> {
  const errors: { path: string; message: string }[] = [];
  const infos: MediaInfo[] = [];
  const stored: StoredMedia[] = [];
  for (const [i, item] of items.entries()) {
    const path = `media.${i}.url`;
    const id = mediaIdFromUrl(item.url);
    if (!id) {
      errors.push({
        path,
        message: "url must be a media_url from create-upload-url",
      });
      continue;
    }
    let row: Awaited<ReturnType<typeof getMediaRow>>;
    try {
      row = await getMediaRow(id);
    } catch (e) {
      if (!(e instanceof PublishError)) throw e;
      errors.push({ path, message: "media not found" });
      continue;
    }
    if (row.org_id !== orgId || row.mode !== mode) {
      errors.push({ path, message: "media not found" });
      continue;
    }
    if (row.status === "failed") {
      errors.push({ path, message: "media failed validation" });
      continue;
    }
    let info: MediaInfo;
    if (row.status === "uploaded") {
      try {
        info = await probeMedia(id);
      } catch (e) {
        if (!(e instanceof PublishError)) throw e;
        errors.push({ path, message: "media was not uploaded" });
        continue;
      }
    } else {
      info = {
        mediaId: id,
        signedUrl: item.url,
        mime: row.mime,
        bytes: row.bytes,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        durationMs: row.duration_ms ?? undefined,
      };
    }
    info.altText = item.alt_text;
    info.thumbnailUrl = item.thumbnail_url;
    infos.push(info);
    stored.push({
      media_id: id,
      url: item.url,
      thumbnail_url: item.thumbnail_url,
      alt_text: item.alt_text,
    });
  }
  if (errors.length)
    throw new ApiError(422, "validation_failed", "Media is invalid", {
      errors,
    });
  if (stored.length) {
    const db = await createServiceClient();
    const { error } = await db
      .from("media")
      .update({ last_used_at: new Date().toISOString() })
      .in(
        "id",
        stored.map((m) => m.media_id),
      );
    if (error) throw error;
  }
  return { infos, stored };
}

type AccountConfigs = {
  social_account_id: string;
  configuration: Record<string, unknown>;
}[];

export function mergeConfig(
  platformConfigs: Record<string, unknown>,
  accountConfigs: AccountConfigs,
  platform: Platform,
  accountId: string,
): Record<string, Json> {
  return {
    ...((platformConfigs[platform] as object | undefined) ?? {}),
    ...(accountConfigs.find((a) => a.social_account_id === accountId)
      ?.configuration ?? {}),
  } as Record<string, Json>;
}

export async function validateForAccounts(
  input: {
    caption: string;
    media: MediaInfo[];
    platform_configurations: Record<string, unknown>;
    account_configurations: AccountConfigs;
  },
  accounts: AccountForPublish[],
  mode: "live" | "test",
  scheduledAt: Date | null,
): Promise<Record<string, RuleViolation[]>> {
  const known = new Set(accounts.map((a) => a.id));
  for (const [i, c] of input.account_configurations.entries())
    if (!known.has(c.social_account_id))
      throw new ApiError(
        422,
        "validation_failed",
        "account_configurations refers to an account not in social_accounts",
        {
          errors: [
            {
              path: `account_configurations.${i}.social_account_id`,
              message: "not in social_accounts",
            },
          ],
        },
      );
  const out: Record<string, RuleViolation[]> = {};
  for (const account of accounts) {
    const platform = account.platform as Platform;
    const violations: RuleViolation[] = [];
    let adapter: ReturnType<typeof adapterFor>;
    try {
      adapter = adapterFor(mode, platform);
    } catch {
      out[account.id] = [
        {
          code: "platform_unavailable",
          message: `${platform} is not available yet`,
        },
      ];
      continue;
    }
    const config = mergeConfig(
      input.platform_configurations,
      input.account_configurations,
      platform,
      account.id,
    );
    const parsed = adapter.configSchema.safeParse(config);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        violations.push({
          code: "invalid_configuration",
          field: `configuration.${issue.path.join(".")}`,
          message: issue.message,
        });
    violations.push(
      ...(await adapter.validatePost({
        caption: input.caption,
        media: input.media,
        config: (parsed.success ? parsed.data : config) as Record<string, Json>,
        account: {
          platformUserId: account.platform_user_id,
          platformData: account.platform_data as Record<string, Json>,
        },
      })),
    );
    const q = await precheck(
      adapter,
      account.id,
      scheduledAt,
      {
        config: (parsed.success ? parsed.data : config) as Record<string, Json>,
      },
      account.platform_data,
    );
    if (!q.ok) violations.push(q.violation);
    if (violations.length) out[account.id] = violations;
  }
  return out;
}

export async function prepareCreate(
  orgId: string,
  mode: "live" | "test",
  input: z.output<typeof CreateSocialPostSchema>,
): Promise<{
  accounts: AccountForPublish[];
  media: Awaited<ReturnType<typeof resolveMedia>>;
  scheduledAt: Date | null;
}> {
  const scheduledAt = input.scheduled_at ? new Date(input.scheduled_at) : null;
  if (mode === "live" && !input.is_draft) {
    const plan = await checkPlanAllows(orgId, "post");
    if (!plan.ok)
      throw new ApiError(
        402,
        "plan_limit_reached",
        "Monthly post limit reached. Upgrade your plan to publish more.",
      );
  }
  const accounts = await resolveAccounts(orgId, mode, input.social_accounts);
  const media = await resolveMedia(orgId, mode, input.media);
  const violations = await validateForAccounts(
    {
      caption: input.caption,
      media: media.infos,
      platform_configurations: input.platform_configurations ?? {},
      account_configurations: input.account_configurations ?? [],
    },
    accounts,
    mode,
    scheduledAt,
  );
  const n = Object.keys(violations).length;
  if (n)
    throw new ApiError(
      422,
      "validation_failed",
      `Post failed validation for ${n} account(s)`,
      { violations },
    );
  return { accounts, media, scheduledAt };
}
