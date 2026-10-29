import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";

let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

import { encryptToken } from "../lib/crypto/tokens";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { PublishError } from "../lib/platforms/types";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

// Year 2096: own far-future day, no other file's worker claims these rows.
const NOW = new Date(Date.UTC(2096, 0, 1));

describe.skipIf(!hasDb)("retry keeps publish_state when no step ran", () => {
  let orgId = "";
  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const { data, error } = await (await testDb())
      .from("organizations")
      .insert({ name: "keep-state", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    await (await testDb()).from("organizations").delete().eq("id", orgId);
  });

  async function mk() {
    const db = await testDb();
    const { data: a, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "tiktok",
        external_id: randomUUID(),
        platform_user_id: randomUUID(),
        status: "connected",
        access_token_enc: await encryptToken("t"),
        refresh_token_enc: await encryptToken("r"),
        token_expires_at: NOW.toISOString(), // due for refresh
      })
      .select()
      .single();
    if (error) throw error;
    const { data: post } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "test",
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
        mode: "test",
        post_id: post?.id,
        social_account_id: a.id,
        platform: "tiktok",
        status: "pending",
        attempts: 1,
        next_attempt_at: NOW.toISOString(),
        publish_state: { stage: "status", data: { publish_id: "p-keep" } },
      } as never)
      .select()
      .single();
    return target as never as { id: string };
  }
  const row = async (id: string) =>
    (
      await (
        await testDb()
      )
        .from("social_post_targets")
        .select("*")
        .eq("id", id)
        .single()
    ).data;

  it("a retryable refresh failure keeps the state", async () => {
    fake = {
      ...mockAdapter,
      platform: "tiktok",
      quota: undefined,
      refreshToken: async () => {
        throw new PublishError("network_error", "retryable", "down");
      },
      publishStep: async () => {
        throw new Error("must not run");
      },
    } as PlatformAdapter;
    const t = await mk();
    await publishTarget(t as never, { now: NOW });
    expect(await row(t.id)).toMatchObject({
      status: "pending",
      publish_state: { stage: "status", data: { publish_id: "p-keep" } },
    });
  });

  it("a retryable error thrown by the adapter still clears the state", async () => {
    fake = {
      ...mockAdapter,
      platform: "tiktok",
      quota: undefined,
      refreshWindowMs: 0,
      publishStep: async () => {
        throw new PublishError("network_error", "retryable", "down");
      },
    } as PlatformAdapter;
    const t = await mk();
    await (await testDb())
      .from("social_accounts")
      .update({
        token_expires_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
      })
      .eq("id", (await row(t.id))?.social_account_id as string);
    await publishTarget(t as never, { now: NOW });
    expect(await row(t.id)).toMatchObject({
      status: "pending",
      publish_state: null,
    });
  });
});
