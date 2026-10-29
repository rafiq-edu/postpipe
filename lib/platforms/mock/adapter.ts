import { randomUUID } from "node:crypto";
import { MockConfigSchema } from "../config-schemas";
import {
  type PlatformAdapter,
  PublishError,
  type PublishStepOutcome,
  type RuleViolation,
  type TokenSet,
} from "../types";

export const MOCK_LIMITS = {
  captionMax: 500, // docs/integrations/mock.md:7
  mediaMax: 4, // docs/integrations/mock.md:8
  videoMaxMs: 120_000, // docs/integrations/mock.md:9
  dailyCap: 100, // docs/integrations/mock.md:10
};

const fail = (
  code: string,
  kind: "retryable" | "permanent" | "auth",
  retryAfterMs?: number,
): PublishStepOutcome => ({
  result: {
    ok: false,
    error: new PublishError(code, kind, `mock ${kind} failure`, retryAfterMs),
  },
});

const freshTokens = (
  platformData: TokenSet["platformData"],
  scopes: string[],
): TokenSet => ({
  accessToken: `mock-access-${randomUUID()}`,
  refreshToken: `mock-refresh-${randomUUID()}`,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  scopes,
  platformData,
});

export const mockAdapter: PlatformAdapter = {
  platform: "mock",
  async getAuthUrl({ state, redirectUri, platformData }) {
    const userId =
      typeof platformData?.user_id === "string" && platformData.user_id !== ""
        ? platformData.user_id
        : "mock-user-1";
    return {
      url: `${redirectUri}?code=${encodeURIComponent(`mock.${userId}`)}&state=${encodeURIComponent(state)}`,
    };
  },
  async exchangeCode({ code }) {
    if (!code.startsWith("mock."))
      throw new PublishError(
        "invalid_code",
        "permanent",
        "mock code must start with mock.",
      );
    return freshTokens({ user_id: code.slice(5) }, ["mock.publish"]);
  },
  async refreshToken(t) {
    return freshTokens(t.platformData, t.scopes);
  },
  async revoke() {},
  async getProfile(t) {
    const id = String(t.platformData?.user_id ?? "mock-user-1");
    return { platformUserId: id, username: id, displayName: `Mock ${id}` };
  },
  async listTargets() {
    return [
      { id: "page-1", kind: "page", name: "Mock Page One" },
      { id: "page-2", kind: "page", name: "Mock Page Two" },
    ];
  },
  configSchema: MockConfigSchema,
  quota: {
    scope: "account",
    dailyCap: MOCK_LIMITS.dailyCap,
    sourceLine: "docs/integrations/mock.md:10",
  },
  validatePost(i) {
    const v: RuleViolation[] = [];
    if (i.caption.length > MOCK_LIMITS.captionMax)
      v.push({
        code: "caption_too_long",
        field: "caption",
        message: "Caption is over 500 characters (docs/integrations/mock.md:7)",
      });
    if (i.media.length > MOCK_LIMITS.mediaMax)
      v.push({
        code: "too_many_media",
        field: "media",
        message: "More than 4 media items (docs/integrations/mock.md:8)",
      });
    i.media.forEach((m, idx) => {
      if (
        m.mime.startsWith("video/") &&
        (m.durationMs ?? 0) > MOCK_LIMITS.videoMaxMs
      )
        v.push({
          code: "video_too_long",
          field: `media[${idx}]`,
          message: "Video is over 120 seconds (docs/integrations/mock.md:9)",
        });
    });
    return v;
  },
  async publishStep(state, i) {
    const caption = i.caption;
    if (i.config.fail === true) return fail("mock_config_fail", "permanent");
    if (caption.startsWith("FAIL_RETRYABLE"))
      return fail("mock_retryable", "retryable");
    if (caption.startsWith("FAIL_PERMANENT"))
      return fail("mock_permanent", "permanent");
    if (caption.startsWith("FAIL_AUTH")) return fail("mock_auth", "auth");
    if (caption.startsWith("RETRY_AFTER_10M"))
      return fail("mock_retryable", "retryable", 600_000);
    if (state.stage === "start") {
      if (caption.startsWith("SLOW_30S"))
        return { next: { stage: "waiting", data: {} }, waitMs: 30_000 };
      if (typeof i.config.delay_ms === "number")
        return {
          next: { stage: "waiting", data: {} },
          waitMs: i.config.delay_ms,
        };
    }
    if (caption.startsWith("MULTI_STEP")) {
      if (state.stage === "start")
        return { next: { stage: "uploaded", data: { steps: 1 } } };
      if (state.stage === "uploaded")
        return { next: { stage: "finalizing", data: { steps: 2 } } };
    }
    const id = `mock-${randomUUID()}`;
    return {
      result: {
        ok: true,
        platformPostId: id,
        platformPostUrl: `https://mock.postpipe.com/p/${id}`,
        meta: { hasUrl: /https?:\/\//i.test(caption) },
      },
    };
  },
};
