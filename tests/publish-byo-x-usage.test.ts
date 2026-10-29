import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";

let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

import { encryptToken } from "../lib/crypto/tokens";
import { upsertPlatformApp } from "../lib/db/queries/platform-apps";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

// Year 2098: own far-future day, no other file's worker claims these rows.
const NOW = new Date(Date.UTC(2098, 0, 1));

describe.skipIf(!hasDb)("X usage is not billed on the org's own X app", () => {
  let orgId = "";
  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    process.env.X_CLIENT_ID = "global-x";
    process.env.X_CLIENT_SECRET = "global-secret";
    const { data, error } = await (await testDb())
      .from("organizations")
      .insert({ name: "publish-byo-x", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    await upsertPlatformApp(orgId, "x", {
      clientId: "org-x",
      clientSecret: "s",
      extra: null,
    });
    fake = {
      ...mockAdapter,
      platform: "x",
      quota: undefined,
      refreshWindowMs: undefined,
      publishStep: async () => ({
        result: { ok: true, platformPostId: "p1", meta: { hasUrl: false } },
      }),
    } as PlatformAdapter;
  });
  afterAll(async () => {
    await (await testDb()).from("organizations").delete().eq("id", orgId);
  });

  async function kindsFor(platformData: Record<string, string>) {
    const db = await testDb();
    const { data: a, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "live",
        platform: "x",
        external_id: randomUUID(),
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("t"),
        refresh_token_enc: await encryptToken("r"),
        token_expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
        platform_data: platformData,
      })
      .select()
      .single();
    if (error) throw error;
    const { data: post } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "live",
        caption: "hi",
        status: "processing",
        social_account_ids: [a.id],
        media: [] as never,
        platform_configurations: {},
      })
      .select()
      .single();
    const { data: target } = await db
      .from("social_post_targets")
      .insert({
        org_id: orgId,
        mode: "live",
        post_id: post?.id,
        social_account_id: a.id,
        platform: "x",
        status: "pending",
        attempts: 0,
        next_attempt_at: NOW.toISOString(),
      } as never)
      .select()
      .single();
    const id = (target as { id: string }).id;
    await publishTarget(target as never, { now: NOW });
    const { data: t } = await db
      .from("social_post_targets")
      .select("status")
      .eq("id", id)
      .single();
    expect(t?.status).toBe("success");
    const { data: u } = await db
      .from("usage_events")
      .select("kind")
      .eq("target_id", id);
    return (u ?? []).map((r) => r.kind).sort();
  }

  it("byo account records post_success only; global account still records x_post", async () => {
    expect(await kindsFor({ byo_client_id: "org-x" })).toEqual([
      "post_success",
    ]);
    expect(await kindsFor({})).toEqual(["post_success", "x_post"]);
  });
});
