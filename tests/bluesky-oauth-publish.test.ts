import { randomBytes, randomUUID } from "node:crypto";
import { NodeOAuthClient } from "@atproto/oauth-client-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const dpop = vi.fn(async (..._a: unknown[]) => fakeFetch);
const revoke = vi
  .spyOn(NodeOAuthClient.prototype, "revoke")
  .mockResolvedValue();
const DID = "did:plc:oauthtest";
const PDS = "https://pds.example.com";

// Stand-in for the library's session fetch: PDS calls only, plus the DID lookup.
const fakeFetch = async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  calls.push(`${init?.method ?? "GET"} ${url}`);
  if (url.startsWith("https://plc.directory/"))
    return Response.json({
      service: [{ id: "#atproto_pds", serviceEndpoint: PDS }],
    });
  if (url.endsWith("com.atproto.repo.createRecord"))
    return Response.json({
      uri: `at://${DID}/app.bsky.feed.post/3kabc`,
      cid: "c",
    });
  return Response.json({ error: "InvalidRequest" }, { status: 400 });
};

vi.mock("../lib/connect/bluesky-oauth", async (orig) => ({
  ...(await orig<typeof import("../lib/connect/bluesky-oauth")>()),
  blueskyDpopFetch: (...a: unknown[]) => dpop(...a),
}));

vi.mock("../lib/webhooks/url-guard", () => ({
  assertPublicUrl: async () => {},
}));

import { encryptToken } from "../lib/crypto/tokens";
import {
  deleteAccount,
  disconnectAccount,
  upsertSocialAccount,
} from "../lib/db/queries/social-accounts";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("bluesky oauth account", () => {
  let orgId = "";
  const day = Date.UTC(2092, 0, 1); // far future, unique per file: other files' worker ticks never claim these rows;

  async function mkAccount(did = DID, auth = "oauth", mode = "live") {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode,
        platform: "bluesky",
        external_id: randomUUID(),
        platform_user_id: did,
        status: "connected",
        access_token_enc: await encryptToken(`oauth:${did}`),
        // in the past: a refresh through the adapter would fail, so success proves it was skipped
        token_expires_at: new Date(day - 3_600_000).toISOString(),
        platform_data: { auth, did, pds: PDS },
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    process.env.SECRETS_SOURCE = "env";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"; // loopback: client needs no key
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t19b", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("publishes through the DPoP fetch and never refreshes", async () => {
    const db = await testDb();
    const a = await mkAccount();
    const at = new Date(day).toISOString();
    const { data: post } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "live",
        caption: "hello",
        status: "scheduled",
        scheduled_at: at,
        social_account_ids: [a.id],
        media: [] as never,
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
        platform: "bluesky",
        status: "pending",
        next_attempt_at: at,
      } as never)
      .select()
      .single();
    // publishTarget, not runPublishTick: a tick claims every due row, so files sharing the DB would steal each other's rows
    await publishTarget(target as never, { now: new Date(day) });
    const { data: t } = await db
      .from("social_post_targets")
      .select("status, error_code, platform_post_id")
      .eq("id", target?.id as string)
      .single();
    expect(t?.error_code).toBeNull();
    expect(t?.status).toBe("success");
    expect(calls.some((c) => c.endsWith("com.atproto.repo.createRecord"))).toBe(
      true,
    );
  }, 20_000);

  it("disconnect revokes only when no other account has the DID", async () => {
    const db = await testDb();
    const { data: org2 } = await db
      .from("organizations")
      .insert({ name: "t19b-2", plan: "builder" })
      .select("id")
      .single();
    const did = `did:plc:${randomUUID()}`;
    const a = await mkAccount(did);
    const { data: b } = await db
      .from("social_accounts")
      .insert({
        ...a,
        id: randomUUID(),
        org_id: org2?.id as string,
        external_id: randomUUID(),
      })
      .select()
      .single();
    await disconnectAccount(orgId, "live", a.id);
    expect(revoke).not.toHaveBeenCalled();
    await disconnectAccount(org2?.id as string, "live", b?.id as string);
    expect(revoke).toHaveBeenCalledWith(did);
    await db
      .from("organizations")
      .delete()
      .eq("id", org2?.id as string);
  });

  it("a test-mode account that claims auth=oauth never gets the DPoP fetch", async () => {
    dpop.mockClear();
    const db = await testDb();
    const a = await mkAccount("did:plc:victim", "oauth", "test");
    const at = new Date(day + 86_400_000).toISOString();
    const { data: post } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "test",
        caption: "x",
        status: "scheduled",
        scheduled_at: at,
        social_account_ids: [a.id],
        media: [] as never,
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
        platform: "bluesky",
        status: "pending",
        next_attempt_at: at,
      } as never)
      .select()
      .single();
    await publishTarget(target as never, { now: new Date(day + 86_400_000) });
    expect(dpop).not.toHaveBeenCalled();
  }, 20_000);

  it("caller platform_data cannot override the server auth field", async () => {
    const row = await upsertSocialAccount({
      orgId,
      mode: "live",
      platform: "bluesky",
      externalId: randomUUID(),
      profile: {
        platformUserId: `did:plc:${randomUUID()}`,
        username: "u",
        displayName: "U",
      },
      tokens: {
        accessToken: "a",
        scopes: [],
        platformData: { auth: "app_password", did: "did:plc:real" },
      },
      platformData: {
        auth: "oauth",
        did: "did:plc:victim",
        pds: "https://evil",
        keep: "me",
      },
    });
    expect(row.platform_data).toEqual({
      auth: "app_password",
      did: "did:plc:real",
      keep: "me",
    });
  });

  it("deleteAccount also releases the session", async () => {
    revoke.mockClear();
    const did = `did:plc:${randomUUID()}`;
    const a = await mkAccount(did);
    await deleteAccount(orgId, "live", a.id);
    expect(revoke).toHaveBeenCalledWith(did);
  });
});
