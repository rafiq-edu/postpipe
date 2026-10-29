import { randomBytes } from "node:crypto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/oauth/[platform]/callback/route";
import { POST as authUrlPost } from "../app/api/v1/social-accounts/auth-url/route";
import { generateApiKey } from "../lib/api/auth";
import { decryptToken } from "../lib/crypto/tokens";
import { findConnectSessionByToken } from "../lib/db/queries/connect-sessions";
import { setAccountTargetToken } from "../lib/db/queries/social-accounts";
import { createEndpoint } from "../lib/db/queries/webhooks";
import { GRAPH_VERSION } from "../lib/platforms/facebook/api";
import accounts from "../lib/platforms/facebook/fixtures/accounts.json";
import longToken from "../lib/platforms/facebook/fixtures/long-token.json";
import token from "../lib/platforms/facebook/fixtures/token.json";
import { hasDb, testDb } from "./db";

const A = `https://graph.facebook.com/${GRAPH_VERSION}`;
const server = setupServer(
  http.get(`${A}/oauth/access_token`, ({ request }) =>
    HttpResponse.json(
      new URL(request.url).searchParams.get("grant_type") ===
        "fb_exchange_token"
        ? longToken
        : token,
    ),
  ),
  http.get(`${A}/me/accounts`, () => HttpResponse.json(accounts)),
  http.get(`${A}/me`, () => HttpResponse.json({ id: "u-1", name: "Alice" })),
);

describe.skipIf(!hasDb)("facebook page token on pick", () => {
  let orgId = "";
  let liveKey = "";
  let endpointId = "";
  const REDIRECT = "https://example.com/done";

  const connect = async (body: Record<string, unknown> = {}) => {
    const res = await authUrlPost(
      new Request("http://localhost:3000/api/v1/social-accounts/auth-url", {
        method: "POST",
        headers: {
          authorization: `Bearer ${liveKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          platform: "facebook",
          external_id: "fb-user",
          redirect_url: REDIRECT,
          ...body,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const url = (await res.json()).url as string;
    const s = await findConnectSessionByToken(url.split("/connect/")[1]);
    return GET(
      new Request(
        `http://localhost:3000/api/oauth/facebook/callback?code=c1&state=${s?.id}`,
      ),
      { params: Promise.resolve({ platform: "facebook" }) },
    );
  };
  const pick = (html: string, targetId: string) =>
    POST(
      new Request("http://localhost:3000/api/oauth/facebook/callback", {
        method: "POST",
        body: new URLSearchParams({
          state: /name="state" value="([^"]+)"/.exec(html)?.[1] as string,
          account_id: /name="account_id" value="([^"]+)"/.exec(
            html,
          )?.[1] as string,
          target_id: targetId,
        }),
      }),
      { params: Promise.resolve({ platform: "facebook" }) },
    );
  const accountIdOf = (res: Response) =>
    (res.headers.get("location") ?? "").split("account_id=")[1] as string;
  const rows = async (pageId: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .select("*")
      .eq("org_id", orgId)
      .eq("platform", "facebook")
      .eq("platform_user_id", pageId)
      .is("deleted_at", null);
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    server.listen();
    process.env.SECRETS_SOURCE = "env";
    process.env.PUBLIC_PLATFORMS = "facebook"; // this file tests the Facebook flow in live mode
    process.env.META_APP_ID = "mid";
    process.env.META_APP_SECRET = "msecret";
    process.env.TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    process.env.CURRENT_TOKEN_KEY_VERSION = "1";
    process.env.NEXT_PUBLIC_CONNECT_URL = "https://connect.postpipe.com";
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "fb-connect", plan: "builder" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    const k = generateApiKey("live");
    liveKey = k.plaintext;
    endpointId = (
      await createEndpoint(orgId, "live", "https://example.com/hook", [
        "social.account.created",
      ])
    ).id;
    const { error: e } = await db.from("api_keys").insert({
      org_id: orgId,
      name: "t",
      key_hash: k.hash,
      key_prefix: k.prefix,
      last4: k.last4,
      mode: "live",
    });
    if (e) throw e;
  });
  afterEach(() => server.resetHandlers());
  afterAll(async () => {
    server.close();
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("the picker shows Pages with CREATE_CONTENT and no token; the pick stores the Page token", async () => {
    const res = await connect();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Page One");
    expect(html).toContain("Page Two");
    expect(html).not.toContain("No Rights");
    expect(html).not.toContain("page-token");
    expect(html).not.toContain("long-user-token");

    const ok = await pick(html, "page-2");
    expect(ok.status).toBe(302);
    const [row] = await rows("page-2");
    expect(row?.id).toBe(accountIdOf(ok));
    expect(await decryptToken(row?.access_token_enc ?? "")).toBe(
      "page-token-2",
    );
    expect(row?.token_expires_at).toBeNull();
    expect(row?.refresh_token_enc).toBeNull();
    expect(row?.display_name).toBe("Page Two");
    expect(JSON.stringify(row?.platform_data)).not.toContain("token");
    expect(await rows("u-1")).toHaveLength(0);
  });

  it("picking the same Page again updates the row instead of adding one", async () => {
    const first = (await rows("page-2"))[0];
    const res = await connect();
    const ok = await pick(await res.text(), "page-2");
    const after = await rows("page-2");
    expect(after).toHaveLength(1);
    expect(accountIdOf(ok)).toBe(first?.id);
    expect(await rows("u-1")).toHaveLength(0);
  });

  it("a preset target_id does the same", async () => {
    const res = await connect({ platform_data: { target_id: "page-1" } });
    expect(res.status).toBe(302);
    const [row] = await rows("page-1");
    expect(row?.id).toBe(accountIdOf(res));
    expect(await decryptToken(row?.access_token_enc ?? "")).toBe(
      "page-token-1",
    );
    expect(await rows("u-1")).toHaveLength(0);
  });

  it("a Page the user cannot publish to is invalid_target", async () => {
    const res = await connect({ platform_data: { target_id: "page-3" } });
    expect(res.headers.get("location")).toContain("reason=invalid_target");
  });

  const createdEvents = async () => {
    const db = await testDb();
    const { data } = await db
      .from("webhook_deliveries")
      .select("payload")
      .eq("endpoint_id", endpointId);
    // sorted: a select without ORDER BY can change row order when another file updates a delivery
    return (data ?? [])
      .map(
        (x) =>
          (x.payload as { data: { account: { id: string } } }).data.account.id,
      )
      .sort();
  };
  // /me/accounts answers normally for the first `ok` calls, then fails: listTargets works, targetToken does not.
  const failAfter = (ok: number) => {
    let calls = 0;
    server.use(
      http.get(`${A}/me/accounts`, () =>
        ++calls <= ok
          ? HttpResponse.json(accounts)
          : new HttpResponse(null, { status: 500 }),
      ),
    );
  };
  const withPages = (extra: object[]) =>
    server.use(
      http.get(`${A}/me/accounts`, () =>
        HttpResponse.json({ data: [...accounts.data, ...extra] }),
      ),
    );
  const page = (id: string) => ({
    id,
    name: id,
    access_token: `tok-${id}`,
    tasks: ["CREATE_CONTENT"],
  });

  it("webhook: one created event with the final id, none for the connection row", async () => {
    const before = await createdEvents();
    withPages([page("page-w")]);
    const res = await connect({ platform_data: { target_id: "page-w" } });
    const id = accountIdOf(res);
    expect((await createdEvents()).filter((x) => !before.includes(x))).toEqual([
      id,
    ]);
  });

  it("a failing targetToken on a preset pick: exchange_failed, no row change, no event", async () => {
    const before = await createdEvents();
    failAfter(1);
    const res = await connect({ platform_data: { target_id: "page-1" } });
    expect(res.headers.get("location")).toContain("reason=exchange_failed");
    expect(await createdEvents()).toEqual(before);
    const [conn] = await rows("u-1");
    expect(conn?.deleted_at).toBeNull();
    expect(await decryptToken(conn?.access_token_enc ?? "")).toBe(
      "long-user-token",
    );
  });

  it("POST error path: targetToken throws, exchange_failed, row unchanged", async () => {
    const html = await (await connect()).text();
    failAfter(1); // listTargets in the POST works, targetToken fails
    const res = await pick(html, "page-1");
    expect(res.headers.get("location")).toContain("reason=exchange_failed");
    const [conn] = await rows("u-1");
    expect(await decryptToken(conn?.access_token_enc ?? "")).toBe(
      "long-user-token",
    );
  });

  it("double submit: two sequential POSTs give the same account", async () => {
    const before = await createdEvents();
    const html = await (await connect()).text();
    const a = await pick(html, "page-2");
    const b = await pick(html, "page-2");
    expect(a.status).toBe(302);
    expect(b.status).toBe(302);
    expect(b.headers.get("location")).toContain("status=success");
    expect(accountIdOf(b)).toBe(accountIdOf(a));
    expect(
      (await createdEvents()).filter((x) => x === accountIdOf(a)).length -
        before.filter((x) => x === accountIdOf(a)).length,
    ).toBe(1); // the replay sends nothing
  });

  it("mode_conflict: a Page already connected in test mode is not merged", async () => {
    const db = await testDb();
    const { data: dup } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform: "facebook",
        external_id: "t",
        platform_user_id: "page-9",
        status: "connected",
      })
      .select()
      .single();
    withPages([page("page-9")]);
    const res = await connect({ platform_data: { target_id: "page-9" } });
    expect(res.headers.get("location")).toContain("reason=mode_conflict");
    const [same] = await rows("page-9");
    expect([same?.id, same?.mode, same?.deleted_at]).toEqual([
      dup?.id,
      "test",
      null,
    ]);
    const [conn] = await rows("u-1");
    expect(conn?.deleted_at).toBeNull();
  });

  it("merge soft-deletes the connection row: its post targets survive", async () => {
    const db = await testDb();
    const mkAcc = async (pu: string) =>
      (
        await db
          .from("social_accounts")
          .insert({
            org_id: orgId,
            mode: "live",
            platform: "facebook",
            external_id: "m",
            platform_user_id: pu,
            status: "connected",
          })
          .select()
          .single()
      ).data;
    const conn = await mkAcc("u-merge");
    const dup = await mkAcc("page-merge");
    const { data: post } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        mode: "live",
        caption: "x",
        status: "completed",
        social_account_ids: [conn?.id as string],
        media: [] as never,
      })
      .select()
      .single();
    const { data: tgt } = await db
      .from("social_post_targets")
      .insert({
        org_id: orgId,
        mode: "live",
        post_id: post?.id,
        social_account_id: conn?.id,
        platform: "facebook",
        status: "success",
      } as never)
      .select()
      .single();
    const r = await setAccountTargetToken(
      conn?.id as string,
      { id: "page-merge", kind: "page", name: "Merge" },
      { accessToken: "tok", scopes: [] },
    );
    expect(r).toEqual({ ok: true, id: dup?.id });
    const { data: kept } = await db
      .from("social_post_targets")
      .select("id")
      .eq("id", (tgt as { id: string }).id);
    expect(kept).toHaveLength(1);
    const { data: old } = await db
      .from("social_accounts")
      .select("deleted_at, access_token_enc, status")
      .eq("id", conn?.id as string)
      .single();
    expect(old?.deleted_at).not.toBeNull();
    expect(old?.access_token_enc).toBeNull();
    expect(old?.status).toBe("disconnected");
  });

  it("plan limit: an org at the cap can re-pick a connected Page; a new Page is refused", async () => {
    const db = await testDb();
    await db.from("organizations").update({ plan: "free" }).eq("id", orgId);
    const { count } = await db
      .from("social_accounts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("mode", "live")
      .eq("status", "connected")
      .neq("platform_user_id", "u-1"); // the connection row of the next flow is not counted
    const fill = Math.max(0, 5 - (count ?? 0));
    if (fill)
      await db.from("social_accounts").insert(
        Array.from({ length: fill }, (_, i) => ({
          org_id: orgId,
          mode: "live",
          status: "connected" as const,
          platform: "mock",
          external_id: `f${i}`,
          platform_user_id: `fill-${i}`,
        })),
      );
    const ok = await connect({ platform_data: { target_id: "page-1" } });
    expect(ok.headers.get("location")).toContain("status=success");
    const before = await createdEvents();
    withPages([page("page-new")]);
    const no = await connect({ platform_data: { target_id: "page-new" } });
    expect(no.headers.get("location")).toContain(
      "reason=account_limit_reached",
    );
    expect(await rows("page-new")).toHaveLength(0);
    expect((await createdEvents()).length).toBe(before.length);
    await db.from("organizations").update({ plan: "builder" }).eq("id", orgId);
  });
});
