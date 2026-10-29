import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "../lib/crypto/tokens";
import { createEndpoint } from "../lib/db/queries/webhooks";
import { runTokenHealth } from "../lib/jobs/token-health";
import { hasDb, testDb } from "./db";

// The wipe is global and these ticks jump a day ahead, so it would wipe other files' fresh Facebook rows. Covered in unpicked-accounts.test.ts.
vi.mock("../lib/db/queries/social-accounts", async (orig) => ({
  ...(await orig<typeof import("../lib/db/queries/social-accounts")>()),
  wipeStaleUnpicked: async () => 0,
}));

const server = setupServer(
  http.post("https://api.pinterest.com/v5/oauth/token", () =>
    HttpResponse.json({
      access_token: "pina-2",
      refresh_token: "pinr-2",
      expires_in: 2592000,
      refresh_token_expires_in: 5184000,
    }),
  ),
  http.get("https://graph.threads.com/refresh_access_token", () =>
    HttpResponse.json({ access_token: "long-2", expires_in: 5183944 }),
  ),
);
const H = 3_600_000;
const D = 24 * H;

describe.skipIf(!hasDb)("token health", () => {
  let orgId = "";
  const t0 = new Date();
  const ids = {} as Record<
    "tiktok" | "linkedin" | "x" | "threads" | "mock" | "pinterest",
    string
  >;

  const mk = async (platform: string, over: Record<string, unknown>) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .insert({
        org_id: orgId,
        mode: "test",
        platform,
        external_id: `th-${platform}`,
        platform_user_id: `pu-${platform}`,
        username: "n",
        display_name: "N",
        access_token_enc: await encryptToken("x"),
        status: "connected",
        ...over,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const rows = async (id: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("webhook_deliveries")
      .select("event, payload")
      .eq("org_id", orgId)
      .filter("payload->data->>account_id", "eq", id);
    if (error) throw error;
    return data;
  };
  const acct = async (id: string) => {
    const db = await testDb();
    const { data, error } = await db
      .from("social_accounts")
      .select("status, expiring_notified_at")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    process.env.PINTEREST_APP_ID = "pid";
    process.env.PINTEREST_APP_SECRET = "psecret";
    process.env.SECRETS_SOURCE = "env";
    server.listen();
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "t17th", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    await createEndpoint(orgId, "test", "https://example.com/hook", [
      "social.account.token_expiring",
      "social.account.disconnected",
    ]);
    ids.tiktok = await mk("tiktok", {
      refresh_token_enc: await encryptToken("r"),
      token_expires_at: new Date(t0.getTime() + D).toISOString(),
      refresh_expires_at: new Date(t0.getTime() + 300 * D).toISOString(),
    });
    ids.linkedin = await mk("linkedin", {
      token_expires_at: new Date(t0.getTime() + 3 * D).toISOString(),
    });
    ids.threads = await mk("threads", {
      mode: "live",
      token_expires_at: new Date(t0.getTime() + 6 * D).toISOString(),
    });
    ids.mock = await mk("mock", {
      token_expires_at: new Date(t0.getTime() + 6 * D).toISOString(),
    });
    ids.pinterest = await mk("pinterest", {
      mode: "live",
      refresh_token_enc: await encryptToken("pinr-1"),
      token_expires_at: new Date(t0.getTime() - 5 * D).toISOString(),
      refresh_expires_at: new Date(t0.getTime() + 3 * D).toISOString(),
    });
    ids.x = await mk("x", {
      token_expires_at: new Date(t0.getTime() - H).toISOString(),
    });
  });
  afterAll(async () => {
    server.close();
    const db = await testDb();
    await db.from("organizations").delete().eq("id", orgId);
  });

  it("ignores a short access token when the refresh token is far out", async () => {
    await runTokenHealth(t0);
    expect(await rows(ids.tiktok)).toHaveLength(0);
    expect(await acct(ids.tiktok)).toEqual({
      status: "connected",
      expiring_notified_at: null,
    });
  });

  it("refreshes an idle Pinterest account whose refresh token expires in 3 days", async () => {
    await runTokenHealth(t0);
    const db = await testDb();
    const { data } = await db
      .from("social_accounts")
      .select("refresh_token_enc, refresh_expires_at, token_expires_at")
      .eq("id", ids.pinterest)
      .single();
    expect(await decryptToken(data?.refresh_token_enc ?? "")).toBe("pinr-2");
    expect(
      new Date(data?.refresh_expires_at ?? "").getTime() - t0.getTime(),
    ).toBeGreaterThan(50 * D);
    expect(new Date(data?.token_expires_at ?? "").getTime()).toBeGreaterThan(
      t0.getTime(),
    );
    expect(await rows(ids.pinterest)).toHaveLength(0);
  });

  it("notifies once for a LinkedIn token 3 days out", async () => {
    await runTokenHealth(t0);
    await runTokenHealth(new Date(t0.getTime() + D));
    const r = await rows(ids.linkedin);
    expect(r).toHaveLength(1);
    expect(r[0]?.event).toBe("social.account.token_expiring");
    const db = await testDb();
    const { data } = await db
      .from("social_accounts")
      .select("token_expires_at")
      .eq("id", ids.linkedin)
      .single();
    const d =
      r.map(
        (x) => (x.payload as unknown as { data: Record<string, string> }).data,
      )[0] ?? {};
    expect(new Date(d.expires_at ?? "").getTime()).toBe(
      new Date(data?.token_expires_at ?? "").getTime(),
    );
    expect(d.connect_url).toContain("/connect/");
    expect((await acct(ids.linkedin)).expiring_notified_at).not.toBeNull();
  });

  it("expires a past-due account once", async () => {
    await runTokenHealth(t0);
    await runTokenHealth(t0);
    const r = await rows(ids.x);
    expect(r).toHaveLength(1);
    expect(r[0]?.event).toBe("social.account.disconnected");
    expect((await acct(ids.x)).status).toBe("expired");
  });

  it("refreshes a Threads token inside its 7-day window, no notice", async () => {
    await runTokenHealth(t0);
    expect(await rows(ids.threads)).toHaveLength(0);
    expect((await acct(ids.threads)).expiring_notified_at).toBeNull();
    const db = await testDb();
    const { data } = await db
      .from("social_accounts")
      .select("token_expires_at")
      .eq("id", ids.threads)
      .single();
    expect(
      new Date(data?.token_expires_at ?? "").getTime() - t0.getTime(),
    ).toBeGreaterThan(50 * D);
  });

  it("leaves other platforms alone: a mock account 6 days out is notified", async () => {
    await runTokenHealth(t0);
    expect((await rows(ids.mock))[0]?.event).toBe(
      "social.account.token_expiring",
    );
  });
});
