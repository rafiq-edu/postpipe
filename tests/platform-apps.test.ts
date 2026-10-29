import { afterAll, describe, expect, it, vi } from "vitest";
import {
  deletePlatformApp,
  hasPlatformApp,
  loadSecretOverrides,
  overridesForAccount,
  upsertPlatformApp,
} from "../lib/db/queries/platform-apps";
import {
  setAccountTargetToken,
  upsertSocialAccount,
} from "../lib/db/queries/social-accounts";
import { getSecret, withSecretOverrides } from "../lib/secrets";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("platform apps queries", () => {
  const orgs: string[] = [];
  afterAll(async () => {
    const db = await testDb();
    for (const id of orgs) await db.from("organizations").delete().eq("id", id);
  });

  it("stores encrypted, upserts once, loads overrides, deletes", async () => {
    const db = await testDb();
    const { data, error } = await db
      .from("organizations")
      .insert({ name: "byo-q", plan: "free" })
      .select("id")
      .single();
    if (error) throw error;
    const org = data.id;
    orgs.push(org);

    await upsertPlatformApp(org, "x", {
      clientId: "cid",
      clientSecret: "shh",
      extra: null,
    });
    expect(await loadSecretOverrides(org, "x")).toEqual({
      X_CLIENT_ID: "cid",
      X_CLIENT_SECRET: "shh",
    });
    expect(await hasPlatformApp(org, "x")).toBe(true);

    await upsertPlatformApp(org, "x", {
      clientId: "cid",
      clientSecret: "new",
      extra: null,
    });
    expect((await loadSecretOverrides(org, "x")).X_CLIENT_SECRET).toBe("new");
    const rows = await db
      .from("platform_apps")
      .select("client_secret_enc")
      .eq("org_id", org);
    expect(rows.data).toHaveLength(1);
    expect(rows.data?.[0].client_secret_enc).not.toBe("new");
    expect(rows.data?.[0].client_secret_enc.startsWith("v")).toBe(true);

    expect(await loadSecretOverrides(org, "bluesky")).toEqual({});
    expect(await loadSecretOverrides(org, "tiktok")).toEqual({});

    await deletePlatformApp(org, "x");
    expect(await loadSecretOverrides(org, "x")).toEqual({});
    expect(await hasPlatformApp(org, "x")).toBe(false);
  });

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
  const keysFor = (org: string, platformData: Record<string, string>) =>
    overridesForAccount(org, "x", platformData).then((o) =>
      withSecretOverrides(o, () => getSecret("X_CLIENT_ID")),
    );

  it("composition: org app overrides the global key", async () => {
    vi.stubEnv("X_CLIENT_ID", "global");
    const org = await mkOrg("byo-c");
    await upsertPlatformApp(org, "x", {
      clientId: "org-id",
      clientSecret: "s",
      extra: null,
    });
    expect(
      await withSecretOverrides(await loadSecretOverrides(org, "x"), () =>
        getSecret("X_CLIENT_ID"),
      ),
    ).toBe("org-id");
  });

  it("account without byo_client_id keeps global keys after the org adds an app", async () => {
    vi.stubEnv("X_CLIENT_ID", "global");
    const org = await mkOrg("byo-g");
    await upsertPlatformApp(org, "x", {
      clientId: "org-id",
      clientSecret: "s",
      extra: null,
    });
    expect(await keysFor(org, {})).toBe("global");
  });

  it("byo account uses org keys; after app delete or change it fails auth, never global", async () => {
    vi.stubEnv("X_CLIENT_ID", "global");
    const org = await mkOrg("byo-b");
    await upsertPlatformApp(org, "x", {
      clientId: "org-id",
      clientSecret: "s",
      extra: null,
    });
    expect(await keysFor(org, { byo_client_id: "org-id" })).toBe("org-id");
    await upsertPlatformApp(org, "x", {
      clientId: "other",
      clientSecret: "s",
      extra: null,
    });
    await expect(
      keysFor(org, { byo_client_id: "org-id" }),
    ).rejects.toMatchObject({
      code: "auth_failed",
      kind: "auth",
    });
    await deletePlatformApp(org, "x");
    await expect(
      keysFor(org, { byo_client_id: "org-id" }),
    ).rejects.toMatchObject({
      code: "auth_failed",
      kind: "auth",
    });
  });

  it("byo_client_id is server-set: caller data cannot set it, reconnect without it clears it, pick keeps it", async () => {
    const org = await mkOrg("byo-s");
    const db = await testDb();
    const base = {
      orgId: org,
      mode: "live" as const,
      platform: "facebook" as const,
      externalId: "ext",
      profile: { platformUserId: "u1", username: "n", displayName: "N" },
      tokens: { accessToken: "a", scopes: [] },
    };
    const pd = async (id: string) =>
      (
        await db
          .from("social_accounts")
          .select("platform_data")
          .eq("id", id)
          .single()
      ).data?.platform_data as Record<string, unknown>;
    const forged = await upsertSocialAccount({
      ...base,
      platformData: { byo_client_id: "forged" },
    });
    expect((await pd(forged.id)).byo_client_id).toBeUndefined();
    const own = await upsertSocialAccount({
      ...base,
      platformData: { byo_client_id: "forged" },
      byoClientId: "org-id",
    });
    expect((await pd(own.id)).byo_client_id).toBe("org-id");
    await setAccountTargetToken(
      own.id,
      { id: "page1", kind: "page", name: "P" },
      { accessToken: "p", scopes: [] },
    );
    const picked = await db
      .from("social_accounts")
      .select("id, platform_data")
      .eq("org_id", org)
      .eq("platform_user_id", "page1")
      .single();
    expect(
      ((picked.data?.platform_data ?? {}) as Record<string, unknown>)
        .byo_client_id,
    ).toBe("org-id");
    const again = await upsertSocialAccount({ ...base, platformData: {} });
    expect((await pd(again.id)).byo_client_id).toBeUndefined();
  });
});
