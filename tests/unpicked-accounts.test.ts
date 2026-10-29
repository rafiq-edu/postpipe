import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPlanAllows } from "../lib/billing/usage";
import { CONNECT_SESSION_TTL_MS } from "../lib/connect/oauth";
import { encryptToken } from "../lib/crypto/tokens";
import {
  getAccount,
  listAccounts,
  wipeStaleUnpicked,
} from "../lib/db/queries/social-accounts";
import type { Json } from "../lib/platforms/types";
import { resolveAccounts } from "../lib/publish/validate";
import { hasDb, testDb } from "./db";

// Real clock, not a far-future year: wipeStaleUnpicked is global, so a future "now" would wipe other files' fresh rows.
const T = new Date();
const TTL = CONNECT_SESSION_TTL_MS;

describe.skipIf(!hasDb)("unpicked Facebook connection rows", () => {
  let org = "";
  let unpicked = "";
  let picked = "";

  const add = async (id: string, platform_data: Json, updated_at: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .insert({
        org_id: org,
        mode: "live",
        platform: "facebook",
        external_id: id,
        platform_user_id: id,
        status: "connected",
        access_token_enc: await encryptToken("tok"),
        platform_data,
        updated_at,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  beforeAll(async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "unpicked", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    org = data.id;
    const old = new Date(T.getTime() - TTL - 60_000).toISOString();
    unpicked = await add("user-1", {}, old);
    picked = await add(
      "page-1",
      { target: { id: "page-1", kind: "page", name: "P" } },
      old,
    );
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", org);
  });

  it("is not listed, not counted, not postable; a picked row is", async () => {
    const list = await listAccounts(org, "live", { limit: 10 });
    expect(list.data.map((a) => a.id)).toEqual([picked]);
    expect(await getAccount(org, "live", unpicked)).toBeNull();
    expect(await getAccount(org, "live", picked)).not.toBeNull();
    await expect(
      resolveAccounts(org, "live", [unpicked]),
    ).rejects.toMatchObject({ code: "unknown_social_account" });
    await expect(resolveAccounts(org, "live", [picked])).resolves.toHaveLength(
      1,
    );
    const db = await testDb();
    const fill = Array.from({ length: 3 }, (_, i) => ({
      org_id: org,
      mode: "live",
      platform: "bluesky",
      external_id: `b${i}`,
      platform_user_id: `b${i}`,
      status: "connected" as const,
    }));
    await db.from("social_accounts").insert(fill);
    // 3 bluesky + 1 picked = 4 of 5; the unpicked row would make 5
    expect(await checkPlanAllows(org, "account")).toEqual({ ok: true });
  });

  it("wipes an unpicked row after the TTL, silently; keeps a picked row", async () => {
    const db = await testDb();
    await wipeStaleUnpicked(new Date(T.getTime() - 2 * TTL));
    const { data: early } = await db
      .from("social_accounts")
      .select("deleted_at")
      .eq("id", unpicked)
      .single();
    expect(early?.deleted_at).toBeNull();
    expect(await wipeStaleUnpicked(T)).toBeGreaterThanOrEqual(1);
    const { data } = await db
      .from("social_accounts")
      .select("id, status, access_token_enc, deleted_at")
      .eq("org_id", org)
      .in("id", [unpicked, picked]);
    const by = Object.fromEntries((data ?? []).map((r) => [r.id, r]));
    expect(by[unpicked]).toMatchObject({
      status: "disconnected",
      access_token_enc: null,
    });
    expect(by[unpicked]?.deleted_at).not.toBeNull();
    expect(by[picked]).toMatchObject({ status: "connected", deleted_at: null });
    const { count } = await db
      .from("webhook_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org);
    expect(count).toBe(0);
  });
});
