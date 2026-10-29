import { recordUsage } from "../billing/usage";
import { blueskyDpopFetch } from "../connect/bluesky-oauth";
import { currentKeyVersion, encryptToken } from "../crypto/tokens";
import { createServiceClient } from "../db/client";
import { isApprovalLimited, loadApprovals } from "../db/queries/approvals";
import { overridesForAccount } from "../db/queries/platform-apps";
import {
  findAccountById,
  loadTokenSet,
  type SocialAccountRow,
} from "../db/queries/social-accounts";
import { serializeResult } from "../db/queries/social-posts";
import type { Json, Tables, TablesUpdate } from "../db/types";
import { logger } from "../log/logger";
import { probeMedia } from "../media/probe";
import { fetchRange } from "../media/s3";
import { createBlueskyAdapter } from "../platforms/bluesky/adapter";
import { adapterFor } from "../platforms/registry";
import {
  type MediaInfo,
  type Platform,
  type PlatformAdapter,
  type Json as PlatformJson,
  PublishError,
  type PublishInput,
  type PublishResult,
  type PublishState,
  type TokenSet,
} from "../platforms/types";
import { withSecretOverrides } from "../secrets";
import { emit } from "../webhooks/events";
import { MAX_ATTEMPTS, retryDelayMs, toPublishError } from "./errors";
import { msToNextMidnight, nextMidnight, quotaDay } from "./quota-day";
import { consume, quotaScope, recordReportedUsage } from "./quotas";
import { mergeConfig, type StoredMedia } from "./validate";

type TargetRow = Tables<"social_post_targets">;
type PostRow = Tables<"social_posts">;

const REFRESH_WINDOW_MS = 10 * 60_000;
const REFRESH_POLL_MS = 200;
const REFRESH_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const tokenNeedsRefresh = (
  adapter: PlatformAdapter,
  t: TokenSet,
  now: Date,
): boolean =>
  t.expiresAt !== undefined &&
  new Date(t.expiresAt).getTime() - now.getTime() <=
    (adapter.refreshWindowMs ?? REFRESH_WINDOW_MS);

/**
 * `refreshExpiryWindowMs` switches the trigger from the access token expiry to the refresh
 * token expiry (idle accounts, token-health job).
 */
export async function refreshIfNeeded(
  account: SocialAccountRow,
  adapter: PlatformAdapter,
  now: Date,
  refreshExpiryWindowMs?: number,
): Promise<TokenSet> {
  const tokens = await loadTokenSet(account);
  const needs = (t: TokenSet) =>
    refreshExpiryWindowMs === undefined
      ? tokenNeedsRefresh(adapter, t, now)
      : t.refreshExpiresAt !== undefined &&
        new Date(t.refreshExpiresAt).getTime() - now.getTime() <=
          refreshExpiryWindowMs;
  if (!needs(tokens)) return tokens;
  const db = await createServiceClient();
  const release = async () => {
    const { error } = await db
      .from("social_accounts")
      .update({ refresh_lock_at: null })
      .eq("id", account.id);
    if (error) throw error;
  };
  const { data: won, error } = await db.rpc("claim_token_refresh", {
    p_account_id: account.id,
    p_now: now.toISOString(),
  });
  if (error) throw error;
  if (won) {
    // another worker may have refreshed between our read and our claim
    const current = await findAccountById(account.org_id, account.id);
    if (current) {
      const t = await loadTokenSet(current);
      if (!needs(t)) {
        await release();
        return t;
      }
    }
    let fresh: TokenSet;
    try {
      fresh = await adapter.refreshToken(tokens);
    } catch (e) {
      await release();
      const pe = toPublishError(e);
      if (pe.kind === "retryable") throw pe;
      throw new PublishError(
        "account_reauth_required",
        "auth",
        "token refresh failed",
      );
    }
    const { error: e2 } = await db
      .from("social_accounts")
      .update({
        access_token_enc: await encryptToken(fresh.accessToken),
        ...(fresh.refreshToken
          ? { refresh_token_enc: await encryptToken(fresh.refreshToken) }
          : {}),
        key_version: currentKeyVersion(),
        token_expires_at: fresh.expiresAt ?? null,
        ...(fresh.refreshExpiresAt
          ? { refresh_expires_at: fresh.refreshExpiresAt }
          : {}),
        expiring_notified_at: null,
        refresh_lock_at: null,
      })
      .eq("id", account.id);
    if (e2) throw e2;
    return fresh;
  }
  const deadline = Date.now() + REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(REFRESH_POLL_MS);
    const current = await findAccountById(account.org_id, account.id);
    if (current && current.refresh_lock_at === null)
      return loadTokenSet(current);
  }
  throw new PublishError(
    "token_refresh_timeout",
    "retryable",
    "another worker is still refreshing the token",
  );
}

export async function prepareMedia(post: PostRow): Promise<MediaInfo[]> {
  const out: MediaInfo[] = [];
  for (const item of post.media as unknown as StoredMedia[]) {
    if (!item.media_id)
      throw new PublishError("media_unreachable", "permanent", "bad media id");
    // probeMedia also returns a signed read URL
    const info = await probeMedia(item.media_id);
    info.altText = item.alt_text;
    info.thumbnailUrl = item.thumbnail_url;
    out.push(info);
  }
  return out;
}

export function usageKinds(
  platform: Platform,
  result: Extract<PublishResult, { ok: true }>,
  platformData?: unknown,
): Array<"post_success" | "x_post" | "x_post_with_url"> {
  // An account on the org's own X app is billed by X, not by PostPipe.
  if (
    platform !== "x" ||
    (platformData as { byo_client_id?: unknown } | null)?.byo_client_id
  )
    return ["post_success"];
  return ["post_success", result.meta?.hasUrl ? "x_post_with_url" : "x_post"];
}

export async function rollupPostStatus(postId: string): Promise<void> {
  const db = await createServiceClient();
  const { error } = await db.rpc("rollup_post_status", { p_post_id: postId });
  if (error) throw error;
}

/** Thrown when another worker took the target while this run was working. */
class LeaseLost extends Error {}

export type TargetOutcome =
  | "success"
  | "wait"
  | "retry"
  | "error"
  | "quota"
  | "skipped";

// Side effects after the target is saved must never turn into a retry (that would publish twice).
async function safely(
  name: string,
  targetId: string,
  fn: () => Promise<unknown>,
) {
  try {
    await fn();
  } catch (e) {
    logger.error("publish.side_effect_failed", {
      name,
      target_id: targetId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function publishTarget(
  target: TargetRow,
  opts: { now: Date },
): Promise<{ outcome: TargetOutcome; latenessMs: number | null }> {
  // Keys come from the app the account was connected with. A key error is handed to the inner run so it takes the normal reauth path.
  let overrides: Record<string, string> = {};
  let keyError: unknown;
  const account = await findAccountById(
    target.org_id,
    target.social_account_id,
  );
  try {
    if (account && account.mode === "live")
      overrides = await overridesForAccount(
        account.org_id,
        account.platform,
        account.platform_data,
      );
  } catch (e) {
    keyError = e;
  }
  return withSecretOverrides(overrides, () =>
    publishTargetInner(target, opts, keyError, account),
  );
}

async function publishTargetInner(
  target: TargetRow,
  opts: { now: Date },
  keyError: unknown,
  account: SocialAccountRow | null,
): Promise<{ outcome: TargetOutcome; latenessMs: number | null }> {
  const { now } = opts;
  const db = await createServiceClient();
  const skip = async (): Promise<{
    outcome: TargetOutcome;
    latenessMs: number | null;
  }> => {
    await db
      .from("social_post_targets")
      .update({ locked_at: null })
      .eq("id", target.id)
      .eq("status", "pending");
    return { outcome: "skipped", latenessMs: null };
  };

  const { data: post, error: pe } = await db
    .from("social_posts")
    .select("*")
    .eq("id", target.post_id)
    .single();
  if (pe) throw pe;
  const { data: cur, error: ce } = await db
    .from("social_post_targets")
    .select("status")
    .eq("id", target.id)
    .single();
  if (ce) throw ce;
  if (post.status === "cancelled" || cur.status !== "pending" || !account)
    return skip();

  const mode = target.mode as "live" | "test";
  const platform = account.platform as Platform;
  const adapter = adapterFor(mode, platform);
  const state0 = target.publish_state as unknown as PublishState | null;
  const { data: run, error: re } = await db
    .from("publish_runs")
    .insert({
      org_id: target.org_id,
      target_id: target.id,
      step: state0?.stage ?? "start",
      status: "running",
      started_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (re) throw re;
  const finishRun = async (status: "success" | "error", detail: Json) => {
    const { error } = await db
      .from("publish_runs")
      .update({ status, finished_at: now.toISOString(), detail })
      .eq("id", run.id);
    if (error) throw error;
  };

  // Writes the target only while this run still owns it (the status and lock it last saw).
  const guardAs = async (
    status: "pending" | "running",
    lock: string | null,
    fields: TablesUpdate<"social_post_targets">,
    cols = "id",
  ) => {
    let q = db
      .from("social_post_targets")
      .update(fields)
      .eq("id", target.id)
      .eq("status", status);
    q = lock === null ? q.is("locked_at", null) : q.eq("locked_at", lock);
    const { data, error } = await q.select(cols).maybeSingle();
    if (error) throw error;
    if (!data) throw new LeaseLost();
    return data as unknown as TargetRow;
  };
  const leaseLost = async () => {
    // Another worker owns the target now: write nothing to it.
    await finishRun("success", { outcome: "lease_lost" });
    return { outcome: "skipped" as const, latenessMs: null };
  };

  const fresh = state0 === null;
  // Only the first attempt takes quota: a retry after a retryable error must not count twice.
  const config = mergeConfig(
    post.platform_configurations as Record<string, unknown>,
    post.account_configurations as Parameters<typeof mergeConfig>[1],
    platform,
    account.id,
  );
  if (
    fresh &&
    target.attempts === 0 &&
    adapter.quota &&
    adapter.quota.appliesTo?.({ config }) !== false
  ) {
    const scope = quotaScope(
      adapter,
      account.id,
      account.platform_data,
    ) as string;
    const tz = adapter.quota.timeZone;
    const day = quotaDay(now, tz);
    if (!(await consume(scope, day, adapter.quota.dailyCap))) {
      try {
        await guardAs("pending", target.locked_at, {
          status: "pending",
          locked_at: null,
          next_attempt_at: nextMidnight(day, tz),
          error_code: "daily_quota_reached",
          error_message: `daily quota reached, retrying after ${tz ?? "UTC"} midnight`,
        });
      } catch (e) {
        if (e instanceof LeaseLost) return leaseLost();
        throw e;
      }
      await finishRun("success", { outcome: "quota" });
      return { outcome: "quota", latenessMs: null };
    }
  }

  const startedAt = target.started_at ?? now.toISOString();
  const { data: started, error: se } = await db
    .from("social_post_targets")
    .update({
      status: "running",
      started_at: startedAt,
      attempts: fresh ? target.attempts + 1 : target.attempts,
    })
    .eq("id", target.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (se) throw se;
  if (!started) {
    await finishRun("success", { outcome: "skipped" });
    return { outcome: "skipped", latenessMs: null };
  }
  await db
    .from("social_posts")
    .update({ status: "processing" })
    .eq("id", post.id)
    .eq("status", "scheduled");
  const latenessMs = post.scheduled_at
    ? new Date(startedAt).getTime() - new Date(post.scheduled_at).getTime()
    : null;

  let result: Extract<PublishResult, { ok: true }>;
  const wall0 = Date.now();
  let lastLock: string | null = started.locked_at;
  // No step ran before the adapter is called, so an earlier retryable error leaves publish_state valid.
  let adapterCalled = false;
  const guard = (fields: TablesUpdate<"social_post_targets">, cols = "id") =>
    guardAs("running", lastLock, fields, cols);
  try {
    // a worker that keeps dying mid-step re-claims the target with attempts + 1 each time
    if (started.attempts > MAX_ATTEMPTS)
      throw new PublishError(
        "max_attempts_exceeded",
        "permanent",
        "too many attempts",
      );
    if (account.status !== "connected")
      throw new PublishError(
        "account_reauth_required",
        "auth",
        "account must be reconnected",
      );
    if (keyError) throw keyError;
    // Bluesky OAuth: the library holds and refreshes the real tokens; we only sign calls.
    const oauth =
      platform === "bluesky" &&
      account.mode === "live" &&
      (account.platform_data as { auth?: unknown } | null)?.auth === "oauth";
    const tokens = oauth
      ? await loadTokenSet(account)
      : await refreshIfNeeded(account, adapter, now);
    const live = oauth
      ? createBlueskyAdapter(await blueskyDpopFetch(account.platform_user_id))
      : adapter;
    if (fresh && adapter.quota && adapter.reportedUsage) {
      const scope = quotaScope(
        adapter,
        account.id,
        account.platform_data,
      ) as string;
      const reported = await adapter
        .reportedUsage(tokens, {
          platformUserId: account.platform_user_id,
          platformData: (account.platform_data ?? {}) as Record<
            string,
            PlatformJson
          >,
        })
        .then(async (u) => {
          await recordReportedUsage(
            scope,
            quotaDay(now, adapter.quota?.timeZone),
            u.used,
          );
          return u;
        })
        // fail open: log the code only, never the message
        .catch((e) => {
          logger.warn("reported_usage_failed", {
            code: e instanceof PublishError ? e.code : "unknown",
          });
          return null;
        });
      if (reported && reported.used >= reported.total)
        throw new PublishError(
          "daily_quota_reached",
          "retryable",
          `platform reports the daily publishing limit is reached, retrying after ${adapter.quota.timeZone ?? "UTC"} midnight`,
          msToNextMidnight(now, adapter.quota.timeZone),
        );
    }
    const media = await prepareMedia(post);
    const input: PublishInput = {
      target: { id: target.id, createdAt: target.created_at },
      caption: post.caption ?? "",
      media,
      config,
      account: {
        platformUserId: account.platform_user_id,
        platformData: (account.platform_data ?? {}) as Record<
          string,
          PlatformJson
        >,
      },
    };
    let state: PublishState = state0 ?? { stage: "start", data: {} };
    for (;;) {
      adapterCalled = true;
      const out = await live.publishStep(state, input, tokens, fetchRange);
      if ("result" in out) {
        // the mock returns failures instead of throwing
        if (!out.result.ok) throw out.result.error;
        result = out.result;
        break;
      }
      state = out.next;
      // Heartbeat: save progress and move the lock forward, only while this run still owns the row.
      // claim_due_targets re-claims a running row after 30 minutes without a lock update.
      const stamp = new Date(now.getTime() + Date.now() - wall0).toISOString();
      const waiting = out.waitMs
        ? {
            status: "pending" as const,
            locked_at: null,
            next_attempt_at: new Date(now.getTime() + out.waitMs).toISOString(),
          }
        : { locked_at: stamp };
      let q = db
        .from("social_post_targets")
        .update({
          publish_state: state as unknown as Json,
          ...(out.platformPublishId
            ? { platform_publish_id: out.platformPublishId }
            : {}),
          ...waiting,
        })
        .eq("id", target.id)
        .eq("status", "running");
      q =
        lastLock === null
          ? q.is("locked_at", null)
          : q.eq("locked_at", lastLock);
      const { data: kept, error: ke } = await q.select("id");
      if (ke) throw ke;
      if (kept.length === 0) throw new LeaseLost();
      lastLock = stamp;
      if (out.waitMs) {
        await finishRun("success", { outcome: "wait", wait_ms: out.waitMs });
        return { outcome: "wait", latenessMs };
      }
    }
  } catch (e) {
    if (e instanceof LeaseLost) return leaseLost();
    try {
      const err = toPublishError(e);
      const logRun = () =>
        finishRun("error", {
          code: err.code,
          kind: err.kind,
          message: err.message,
          retry_after_ms: err.retryAfterMs ?? null,
        });
      const fail = { locked_at: null, publish_state: null } as const;
      const info = { error_code: err.code, error_message: err.message };
      const settle = async (
        fields: TablesUpdate<"social_post_targets">,
        before?: () => Promise<void>,
      ) => {
        const row = await guard({ ...fail, ...fields }, "*");
        await safely("run_log", target.id, logRun);
        if (before) await safely("account_flip", target.id, before);
        await safely("result_event", target.id, async () =>
          emit(target.org_id, mode, "social.post.result.created", {
            post_id: post.id,
            result: serializeResult(
              row,
              platform,
              isApprovalLimited((await loadApprovals())[platform]),
            ),
          }),
        );
        await safely("rollup", target.id, () => rollupPostStatus(post.id));
        return { outcome: "error" as const, latenessMs };
      };
      if (err.kind === "retryable" && started.attempts < MAX_ATTEMPTS) {
        await guard({
          ...(adapterCalled ? fail : { locked_at: null }),
          status: "pending",
          next_attempt_at: new Date(
            now.getTime() + retryDelayMs(started.attempts, err.retryAfterMs),
          ).toISOString(),
          ...info,
        });
        await safely("run_log", target.id, logRun);
        return { outcome: "retry", latenessMs };
      }
      if (err.kind === "auth")
        return await settle(
          {
            status: "error",
            error_code: "account_reauth_required",
            error_message: err.message,
          },
          async () => {
            const { data: flipped, error } = await db
              .from("social_accounts")
              .update({ status: "expired" })
              .eq("id", account.id)
              .eq("status", "connected")
              .select("id");
            if (error) throw error;
            if (flipped.length)
              await safely("disconnected_event", target.id, () =>
                emit(target.org_id, mode, "social.account.disconnected", {
                  account_id: account.id,
                  platform,
                  external_id: account.external_id,
                }),
              );
          },
        );
      return await settle({ status: "error", ...info });
    } catch (e2) {
      if (e2 instanceof LeaseLost) return leaseLost();
      throw e2;
    }
  }

  let row: TargetRow;
  try {
    row = await guard(
      {
        status: "success",
        platform_post_id: result.platformPostId,
        platform_post_url: result.platformPostUrl ?? null,
        published_at: now.toISOString(),
        publish_state: null,
        locked_at: null,
        error_code: null,
        error_message: null,
      },
      "*",
    );
  } catch (e) {
    if (e instanceof LeaseLost) return leaseLost();
    throw e;
  }
  await safely("run_log", target.id, () =>
    finishRun("success", { outcome: "published" }),
  );
  for (const kind of usageKinds(platform, result, account.platform_data))
    await safely("usage", target.id, () =>
      recordUsage(target.org_id, target.id, kind),
    );
  await safely("result_event", target.id, async () =>
    emit(target.org_id, mode, "social.post.result.created", {
      post_id: post.id,
      result: serializeResult(
        row,
        platform,
        isApprovalLimited((await loadApprovals())[platform]),
      ),
    }),
  );
  await safely("rollup", target.id, () => rollupPostStatus(post.id));
  return { outcome: "success", latenessMs };
}

/**
 * An inbound platform event names the post id of a target that is still being
 * processed (TikTok: post.publish.publicly_available). Settles it as success
 * once, through a status-guarded update, so a duplicate event changes nothing
 * and emits nothing. A target that already settled with the placeholder id
 * (the publish id, see the TikTok adapter) only gets the real post id.
 */
export async function settleExternalSuccess(
  target: Pick<TargetRow, "id" | "org_id" | "post_id" | "mode" | "platform">,
  platformPostId: string,
  placeholder: string,
  now: Date,
): Promise<"settled" | "updated" | "unchanged"> {
  const db = await createServiceClient();
  const { data: row, error } = await db
    .from("social_post_targets")
    .update({
      status: "success",
      platform_post_id: platformPostId,
      published_at: now.toISOString(),
      publish_state: null,
      locked_at: null,
      error_code: null,
      error_message: null,
    })
    .eq("id", target.id)
    // A signed event proves the post is live, so these two "unknown outcome" errors are settled too.
    .or(
      "status.in.(pending,running),and(status.eq.error,error_code.in.(post_outcome_unknown,media_processing_timeout))",
    )
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    const { data: fixed, error: fe } = await db
      .from("social_post_targets")
      .update({ platform_post_id: platformPostId })
      .eq("id", target.id)
      .eq("status", "success")
      .eq("platform_post_id", placeholder)
      .select("id");
    if (fe) throw fe;
    return fixed.length ? "updated" : "unchanged";
  }
  const mode = target.mode as "live" | "test";
  const platform = target.platform as Platform;
  const result = { ok: true, platformPostId } as const;
  for (const kind of usageKinds(platform, result))
    await safely("usage", target.id, () =>
      recordUsage(target.org_id, target.id, kind),
    );
  await safely("result_event", target.id, async () =>
    emit(target.org_id, mode, "social.post.result.created", {
      post_id: target.post_id,
      result: serializeResult(
        row,
        platform,
        isApprovalLimited((await loadApprovals())[platform]),
      ),
    }),
  );
  await safely("rollup", target.id, () => rollupPostStatus(target.post_id));
  return "settled";
}
