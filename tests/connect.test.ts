import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/oauth/[platform]/callback/route";
import { POST as authUrlPost } from "../app/api/v1/social-accounts/auth-url/route";
import { generateApiKey } from "../lib/api/auth";
import { callbackUrl } from "../lib/connect/oauth";
import { decryptToken } from "../lib/crypto/tokens";
import { findConnectSessionByToken } from "../lib/db/queries/connect-sessions";
import { createEndpoint } from "../lib/db/queries/webhooks";
import { adapterFor } from "../lib/platforms/registry";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("connect flow", () => {
  let orgId = "";
  let endpointId = "";
  const keys = {} as Record<"live" | "test", string>;
  const REDIRECT = "https://example.com/done";

  const authUrl = (key: string, body: unknown) =>
    authUrlPost(
      new Request("http://localhost:3000/api/v1/social-accounts/auth-url", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  const callbackGet = (platform: string, query: string) =>
    GET(
      new Request(
        `http://localhost:3000/api/oauth/${platform}/callback?${query}`,
      ),
      { params: Promise.resolve({ platform }) },
    );
  const sessionOf = async (url: string) => {
    const s = await findConnectSessionByToken(url.split("/connect/")[1]);
    if (!s) throw new Error("no session");
    return s;
  };
  const completeOAuth = async (connectUrl: string) => {
    const s = await sessionOf(connectUrl);
    const { url } = await adapterFor(
      s.mode as "live" | "test",
      s.platform as never,
    ).getAuthUrl({
      state: s.id,
      redirectUri: callbackUrl("mock"),
      platformData: s.platform_data as Record<string, never>,
    });
    const q = new URL(url).searchParams;
    return callbackGet(
      "mock",
      `code=${encodeURIComponent(q.get("code") ?? "")}&state=${q.get("state")}`,
    );
  };
  const connect = async (body: Record<string, unknown>, key = keys.test) => {
    const res = await authUrl(key, {
      platform: "mock",
      external_id: "u1",
      redirect_url: REDIRECT,
      ...body,
    });
    expect(res.status).toBe(200);
    return (await res.json()).url as string;
  };
  const accountOf = async (id: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  };
  const accountIdOf = (res: Response) =>
    (res.headers.get("location") ?? "").split("account_id=")[1];

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_CONNECT_URL = "https://connect.postpipe.com";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t12", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    for (const mode of ["live", "test"] as const) {
      const k = generateApiKey(mode);
      keys[mode] = k.plaintext;
      const { error: e } = await db.from("api_keys").insert({
        org_id: orgId,
        name: "t",
        key_hash: k.hash,
        key_prefix: k.prefix,
        last4: k.last4,
        mode,
      });
      if (e) throw e;
    }
    endpointId = (
      await createEndpoint(orgId, "test", "https://example.com/hook", [
        "social.account.created",
      ])
    ).id;
  });
  afterAll(async () => {
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("auth-url creates a session", async () => {
    const res = await authUrl(keys.test, {
      platform: "mock",
      external_id: "u1",
      redirect_url: REDIRECT,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(
      /^https:\/\/connect\.postpipe\.com\/connect\/[A-Za-z0-9_-]{43}$/,
    );
    const mins = (Date.parse(body.expires_at) - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(9);
    expect(mins).toBeLessThanOrEqual(10);
    const s = await sessionOf(body.url);
    const token = body.url.split("/connect/")[1];
    expect(s.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(s.state).toBe(s.id);
    expect(s.pkce_verifier_enc).toMatch(/^v1\./);
    expect(s.used_at).toBeNull();
  });

  it("invalid state gives 400", async () => {
    for (const state of ["abc", randomUUID()]) {
      const res = await callbackGet("mock", `code=mock.x&state=${state}`);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_state");
    }
  });

  it("expired and used sessions give 410", async () => {
    const db = await testDb();
    const patches = [
      { expires_at: new Date(Date.now() - 60_000).toISOString() },
      { used_at: new Date().toISOString() },
    ];
    for (const patch of patches) {
      const s = await sessionOf(await connect({}));
      await db.from("connect_sessions").update(patch).eq("id", s.id);
      const res = await callbackGet("mock", `code=mock.x&state=${s.id}`);
      expect(res.status).toBe(410);
      expect((await res.json()).code).toBe("session_expired");
    }
  });

  it("success with preset target, upsert and webhook", async () => {
    const body = { platform_data: { user_id: "alice", target_id: "page-2" } };
    const url = await connect(body);
    const res = await completeOAuth(url);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(
      /^https:\/\/example\.com\/done\?status=success&account_id=[0-9a-f-]{36}$/,
    );
    const id = accountIdOf(res);
    const row = await accountOf(id);
    expect(row).toMatchObject({
      platform: "mock",
      external_id: "u1",
      platform_user_id: "alice",
      status: "connected",
    });
    expect(row.access_token_enc).toMatch(/^v1\./);
    expect(await decryptToken(row.access_token_enc as string)).toMatch(
      /^mock-access-/,
    );
    expect(row.refresh_token_enc).not.toBeNull();
    const pd = row.platform_data as Record<string, { id: string }>;
    expect(pd.target.id).toBe("page-2");
    expect("target_id" in pd).toBe(false);
    expect((await sessionOf(url)).used_at).not.toBeNull();

    const db = await testDb();
    const { data: d } = await db
      .from("webhook_deliveries")
      .select("payload")
      .eq("endpoint_id", endpointId);
    const mine = (d ?? []).filter(
      (x) =>
        (x.payload as { data: { account: { id: string } } }).data.account.id ===
        id,
    );
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine[0].payload)).not.toMatch(
      /_enc|access_token|refresh_token/i,
    );

    const res2 = await completeOAuth(await connect(body));
    expect(accountIdOf(res2)).toBe(id);
    const { count } = await db
      .from("social_accounts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("platform_user_id", "alice");
    expect(count).toBe(1);
  });

  it("picker flow", async () => {
    const res = await completeOAuth(
      await connect({ platform_data: { user_id: "bob" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Mock Page One");
    expect(html).toContain("Mock Page Two");
    const state = /name="state" value="([^"]+)"/.exec(html)?.[1] as string;
    const accountId = /name="account_id" value="([^"]+)"/.exec(
      html,
    )?.[1] as string;
    const post = (account_id: string) => {
      const form = new URLSearchParams({
        state,
        account_id,
        target_id: "page-1",
      });
      return POST(
        new Request("http://localhost:3000/api/oauth/mock/callback", {
          method: "POST",
          body: form,
        }),
        { params: Promise.resolve({ platform: "mock" }) },
      );
    };
    const ok = await post(accountId);
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toContain("status=success&account_id=");
    const pd = (await accountOf(accountId)).platform_data as Record<
      string,
      { name: string }
    >;
    expect(pd.target.name).toBe("Mock Page One");
    const bad = await post(randomUUID());
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("invalid_state");
    const db = await testDb();
    const { data: other } = await db
      .from("social_accounts")
      .select("id")
      .eq("org_id", orgId)
      .eq("platform", "mock")
      .neq("id", accountId)
      .limit(1)
      .single();
    const wrong = await post(other?.id as string);
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).code).toBe("validation_failed");
  });

  it("second GET with the same state gives 410", async () => {
    const s = await sessionOf(await connect({}));
    const first = await callbackGet("mock", `code=mock.once&state=${s.id}`);
    expect(first.status).toBe(200);
    const again = await callbackGet("mock", `code=mock.once&state=${s.id}`);
    expect(again.status).toBe(410);
    expect((await again.json()).code).toBe("session_expired");
  });

  it("error and exchange failure redirect", async () => {
    let s = await sessionOf(await connect({}));
    let res = await callbackGet("mock", `error=access_denied&state=${s.id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(
      "status=error&reason=access_denied",
    );
    s = await sessionOf(await connect({}));
    res = await callbackGet("mock", `code=bad&state=${s.id}`);
    expect(res.headers.get("location")).toContain("reason=exchange_failed");
  });

  it("test key with platform tiktok uses mock", async () => {
    const res = await completeOAuth(
      await connect({
        platform: "tiktok",
        platform_data: { user_id: "tt", target_id: "page-1" },
      }),
    );
    expect(res.status).toBe(302);
    expect((await accountOf(accountIdOf(res))).platform).toBe("tiktok");
  });

  it("live key: mock gives 422", async () => {
    for (const platform of ["mock"]) {
      const res = await authUrl(keys.live, {
        platform,
        external_id: "u1",
        redirect_url: REDIRECT,
      });
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("validation_failed");
    }
  });

  it("free org at 5 accounts is refused", async () => {
    const db = await testDb();
    const { error } = await db.from("social_accounts").insert(
      Array.from({ length: 5 }, (_, i) => ({
        org_id: orgId,
        mode: "live",
        status: "connected" as const,
        platform: "mock",
        external_id: `l${i}`,
        platform_user_id: `live-${i}`,
      })),
    );
    if (error) throw error;
    const { createConnectSession } = await import(
      "../lib/db/queries/connect-sessions"
    );
    const s = await createConnectSession({
      orgId,
      mode: "live",
      platform: "mock",
      externalId: "x",
      redirectUrl: REDIRECT,
      platformData: {},
    });
    const res = await callbackGet("mock", `code=mock.new&state=${s.id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(
      "reason=account_limit_reached",
    );
    const { count } = await db
      .from("social_accounts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("mode", "live");
    expect(count).toBe(5);
  });

  const liveSession = async () => {
    const { createConnectSession } = await import(
      "../lib/db/queries/connect-sessions"
    );
    return createConnectSession({
      orgId,
      mode: "live",
      platform: "mock",
      externalId: "x",
      redirectUrl: REDIRECT,
      platformData: {},
    });
  };

  it("test-mode connect cannot overwrite a live account", async () => {
    const db = await testDb();
    const { data: before } = await db
      .from("social_accounts")
      .select("*")
      .eq("org_id", orgId)
      .eq("platform_user_id", "live-0")
      .single();
    const res = await completeOAuth(
      await connect({ platform_data: { user_id: "live-0" } }),
    );
    expect(res.headers.get("location")).toContain("reason=mode_conflict");
    const { data: after } = await db
      .from("social_accounts")
      .select("*")
      .eq("org_id", orgId)
      .eq("platform_user_id", "live-0")
      .single();
    expect(after).toEqual(before);
    expect(after?.mode).toBe("live");
  });

  it("reconnecting a revoked account at the limit is refused", async () => {
    const db = await testDb();
    const { error } = await db.from("social_accounts").insert({
      org_id: orgId,
      mode: "live",
      status: "revoked",
      platform: "mock",
      external_id: "rev",
      platform_user_id: "live-rev",
    });
    if (error) throw error;
    const s = await liveSession();
    const res = await callbackGet("mock", `code=mock.live-rev&state=${s.id}`);
    expect(res.headers.get("location")).toContain(
      "reason=account_limit_reached",
    );
    const { data } = await db
      .from("social_accounts")
      .select("status")
      .eq("org_id", orgId)
      .eq("platform_user_id", "live-rev")
      .single();
    expect(data?.status).toBe("revoked");
  });
});
