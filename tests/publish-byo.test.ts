import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "../lib/platforms/types";

let fake: PlatformAdapter;
vi.mock("../lib/platforms/registry", async (orig) => {
  const m = await orig<typeof import("../lib/platforms/registry")>();
  return { ...m, adapterFor: () => fake };
});

import { encryptToken } from "../lib/crypto/tokens";
import {
  deletePlatformApp,
  upsertPlatformApp,
} from "../lib/db/queries/platform-apps";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { PublishError } from "../lib/platforms/types";
import { publishTarget } from "../lib/publish/steps";
import { getSecret } from "../lib/secrets";
import { hasDb, testDb } from "./db";

// Year 2097: own far-future day, no other file's worker claims these rows.
const NOW = new Date(Date.UTC(2097, 0, 1));

describe.skipIf(!hasDb)(
  "publish uses the keys the account was connected with",
  () => {
    let orgId = "";
    let seen: string | null = null;
    beforeAll(async () => {
      process.env.SECRETS_SOURCE = "env";
      process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
      process.env.CURRENT_TOKEN_KEY_VERSION = "1";
      process.env.TIKTOK_CLIENT_KEY = "global-key";
      const { data, error } = await (await testDb())
        .from("organizations")
        .insert({ name: "publish-byo", plan: "builder" })
        .select("id")
        .single();
      if (error) throw error;
      orgId = data.id;
      fake = {
        ...mockAdapter,
        platform: "tiktok",
        quota: undefined,
        refreshWindowMs: undefined,
        publishStep: async () => {
          seen = await getSecret("TIKTOK_CLIENT_KEY");
          throw new PublishError("stop", "permanent", "stop here");
        },
      } as PlatformAdapter;
    });
    afterAll(async () => {
      await (await testDb()).from("organizations").delete().eq("id", orgId);
    });

    async function mk(platformData: Record<string, string>) {
      const db = await testDb();
      const { data: a, error } = await db
        .from("social_accounts")
        .insert({
          org_id: orgId,
          mode: "live",
          platform: "tiktok",
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
          platform: "tiktok",
          status: "pending",
          attempts: 0,
          next_attempt_at: NOW.toISOString(),
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

    it("global account keeps global keys after the org adds an app; byo account uses org keys; byo account with the app gone fails auth", async () => {
      await upsertPlatformApp(orgId, "tiktok", {
        clientId: "org-key",
        clientSecret: "s",
        extra: null,
      });
      seen = null;
      await publishTarget((await mk({})) as never, { now: NOW });
      expect(seen).toBe("global-key");

      seen = null;
      await publishTarget((await mk({ byo_client_id: "org-key" })) as never, {
        now: NOW,
      });
      expect(seen).toBe("org-key");

      await deletePlatformApp(orgId, "tiktok");
      seen = null;
      const t = await mk({ byo_client_id: "org-key" });
      await publishTarget(t as never, { now: NOW });
      expect(seen).toBeNull();
      expect(await row(t.id)).toMatchObject({
        status: "error",
        error_code: "account_reauth_required",
      });
    });
  },
);
