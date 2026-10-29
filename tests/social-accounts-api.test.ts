import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as disconnect } from "../app/api/v1/social-accounts/[id]/disconnect/route";
import {
  DELETE,
  GET as getOne,
} from "../app/api/v1/social-accounts/[id]/route";
import { POST as authUrlPost } from "../app/api/v1/social-accounts/auth-url/route";
import { GET as list } from "../app/api/v1/social-accounts/route";
import { generateApiKey } from "../lib/api/auth";
import { SocialAccountSchema } from "../lib/api/schemas/social-accounts";
import { encryptToken } from "../lib/crypto/tokens";
import { upsertPlatformApp } from "../lib/db/queries/platform-apps";
import { upsertSocialAccount } from "../lib/db/queries/social-accounts";
import { createEndpoint } from "../lib/db/queries/webhooks";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import { hasDb, testDb } from "./db";

const SECRET = /_enc|access_token|refresh_token/i;

describe.skipIf(!hasDb)("/v1/social-accounts", () => {
  const orgs: string[] = [];
  let keyA = "";
  let keyB = "";
  let liveA = "";
  let orgA = "";
  const ids = {} as Record<"u1a" | "u1b" | "u2" | "tt" | "b", string>;

  const mkKey = async (orgId: string, mode: "live" | "test") => {
    const db = await testDb();
    const k = generateApiKey(mode);
    const { error } = await db.from("api_keys").insert({
      org_id: orgId,
      name: "t",
      key_hash: k.hash,
      key_prefix: k.prefix,
      last4: k.last4,
      mode,
    });
    if (error) throw error;
    return k.plaintext;
  };
  const mkOrg = async (name: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name, plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgs.push(data.id);
    return data.id;
  };
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const mkAccount = async (
    orgId: string,
    mode: "live" | "test",
    platform: string,
    external_id: string,
    created_at: string,
  ) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode,
        platform,
        external_id,
        platform_user_id: `pu-${Math.random()}`,
        username: "n",
        display_name: "N",
        access_token_enc: await encryptToken("a"),
        refresh_token_enc: await encryptToken("r"),
        status: "connected",
        created_at,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const call = async (
    method: string,
    path: string,
    key: string,
    id?: string,
  ) => {
    const req = new Request(`http://localhost/api/v1/social-accounts${path}`, {
      method,
      headers: { authorization: `Bearer ${key}` },
    });
    const route = id ? { params: Promise.resolve({ id }) } : undefined;
    const fn = path.endsWith("/disconnect")
      ? disconnect
      : id
        ? method === "DELETE"
          ? DELETE
          : getOne
        : list;
    const res = await fn(req, route);
    if (res.status === 200)
      expect(JSON.stringify(await res.clone().json())).not.toMatch(SECRET);
    return res;
  };

  beforeAll(async () => {
    const a = await mkOrg("t13a");
    const b = await mkOrg("t13b");
    keyA = await mkKey(a, "test");
    orgA = a;
    liveA = await mkKey(a, "live");
    keyB = await mkKey(b, "test");
    await createEndpoint(a, "test", "https://example.com/hook", [
      "social.account.disconnected",
    ]);
    ids.u1a = await mkAccount(a, "test", "mock", "u1", ago(3));
    ids.u1b = await mkAccount(a, "test", "mock", "u1", ago(2));
    ids.u2 = await mkAccount(a, "test", "mock", "u2", ago(1));
    ids.tt = await mkAccount(a, "test", "tiktok", "u3", ago(4));
    await mkAccount(a, "live", "mock", "u1", ago(1));
    ids.b = await mkAccount(b, "test", "mock", "u1", ago(1));
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().in("id", orgs);
  });

  it("lists scoped, filtered and paginated", async () => {
    const all = await (await call("GET", "", keyA)).json();
    expect(all.data.map((r: { id: string }) => r.id)).toEqual([
      ids.u2,
      ids.u1b,
      ids.u1a,
      ids.tt,
    ]);
    const n = async (q: string) =>
      (await (await call("GET", q, keyA)).json()).data.length;
    expect(await n("?platform=mock")).toBe(3);
    expect(await n("?external_id=u1")).toBe(2);
    expect(await n("?external_id=u1&platform=tiktok")).toBe(0);

    const p1 = await (await call("GET", "?limit=2", keyA)).json();
    expect(p1.data).toHaveLength(2);
    expect(p1.next_cursor).toBeTruthy();
    const p2 = await (
      await call(
        "GET",
        `?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`,
        keyA,
      )
    ).json();
    expect(p2.data.map((r: { id: string }) => r.id)).toEqual([ids.u1a, ids.tt]);
    expect(p2.next_cursor).toBeNull();

    const big = await call("GET", "?limit=101", keyA);
    expect(big.status).toBe(422);
    expect((await big.json()).code).toBe("validation_failed");
    expect((await call("GET", "?cursor=garbage", keyA)).status).toBe(422);
  });

  it("get is org scoped", async () => {
    const other = await call("GET", `/${ids.b}`, keyA, ids.b);
    expect(other.status).toBe(404);
    expect((await other.json()).code).toBe("not_found");
    expect((await call("GET", "/nope", keyA, "nope")).status).toBe(404);
    const own = await call("GET", `/${ids.u2}`, keyA, ids.u2);
    expect(own.status).toBe(200);
    expect(SocialAccountSchema.safeParse(await own.json()).success).toBe(true);
  });

  it("disconnect revokes, wipes, emits once", async () => {
    const spy = vi.spyOn(mockAdapter, "revoke");
    const path = `/${ids.u1a}/disconnect`;
    const res = await call("POST", path, keyA, ids.u1a);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("disconnected");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].accessToken).toBe("a");

    const db = await testDb();
    const { data: row } = await db
      .from("social_accounts")
      .select("access_token_enc, refresh_token_enc, deleted_at")
      .eq("id", ids.u1a)
      .single();
    expect(row).toEqual({
      access_token_enc: null,
      refresh_token_enc: null,
      deleted_at: null,
    });
    const deliveries = async () =>
      (await db.from("webhook_deliveries").select("payload")).data?.filter(
        (d) =>
          (d.payload as { data: { account_id: string } }).data.account_id ===
          ids.u1a,
      ) ?? [];
    const ds = await deliveries();
    expect(ds).toHaveLength(1);
    expect(
      (ds[0].payload as { data: { external_id: string } }).data.external_id,
    ).toBe("u1");

    expect((await call("POST", path, keyA, ids.u1a)).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await deliveries()).toHaveLength(1);
    spy.mockRestore();
  });

  it("delete wipes tokens, keeps row, hides it, reconnect revives", async () => {
    expect((await call("DELETE", `/${ids.b}`, keyA, ids.b)).status).toBe(404);
    expect((await call("DELETE", `/${ids.u2}`, keyA, ids.u2)).status).toBe(204);
    const db = await testDb();
    const { data: row } = await db
      .from("social_accounts")
      .select(
        "access_token_enc, refresh_token_enc, deleted_at, org_id, platform_user_id",
      )
      .eq("id", ids.u2)
      .single();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.access_token_enc).toBeNull();
    expect(row?.refresh_token_enc).toBeNull();
    expect((await call("GET", `/${ids.u2}`, keyA, ids.u2)).status).toBe(404);
    const ls = await (await call("GET", "", keyA)).json();
    expect(ls.data.map((r: { id: string }) => r.id)).not.toContain(ids.u2);

    await upsertSocialAccount({
      orgId: row?.org_id ?? "",
      mode: "test",
      platform: "mock",
      externalId: "u2",
      profile: {
        platformUserId: row?.platform_user_id ?? "",
        username: "n",
        displayName: "N",
      },
      tokens: { accessToken: "a2", scopes: [], platformData: {} },
      platformData: {},
    });
    const ls2 = await (await call("GET", "", keyA)).json();
    expect(ls2.data.map((r: { id: string }) => r.id)).toContain(ids.u2);
    const lsB = await (await call("GET", "", keyB)).json();
    expect(lsB.data.map((r: { id: string }) => r.id)).toEqual([ids.b]);
  });

  it("auth-url gates a platform outside PUBLIC_PLATFORMS until the org has its own app", async () => {
    const post = () =>
      authUrlPost(
        new Request("http://localhost/api/v1/social-accounts/auth-url", {
          method: "POST",
          headers: {
            authorization: `Bearer ${liveA}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            platform: "tiktok",
            external_id: "gate",
            redirect_url: "https://example.com/done",
          }),
        }),
      );
    const blocked = await post();
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).code).toBe("platform_not_available");
    await upsertPlatformApp(orgA, "tiktok", {
      clientId: "cid",
      clientSecret: "shh",
      extra: null,
    });
    expect((await post()).status).not.toBe(422);
  });
});
