import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/oauth/[platform]/callback/route";
import ConnectPage from "../app/connect/[token]/page";
import { createConnectSession } from "../lib/db/queries/connect-sessions";
import { upsertPlatformApp } from "../lib/db/queries/platform-apps";
import { adapterFor } from "../lib/platforms/registry";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)(
  "live connect gate for platforms outside PUBLIC_PLATFORMS",
  () => {
    let orgId = "";
    beforeAll(async () => {
      process.env.SECRETS_SOURCE = "env";
      process.env.TOKEN_KEY_V1 ??= randomBytes(32).toString("base64");
      process.env.CURRENT_TOKEN_KEY_VERSION ??= "1";
      process.env.TIKTOK_CLIENT_KEY ??= "global-key";
      process.env.PUBLIC_PLATFORMS = "bluesky";
      const { data, error } = await (await testDb())
        .from("organizations")
        .insert({ name: "connect-gate", plan: "free" })
        .select("id")
        .single();
      if (error) throw error;
      orgId = data.id;
    });
    afterAll(async () => {
      await (await testDb()).from("organizations").delete().eq("id", orgId);
    });

    const mk = (mode: "live" | "test" = "live") =>
      createConnectSession({
        orgId,
        mode,
        platform: "tiktok",
        externalId: "gate",
        redirectUrl: "https://example.com/done",
        platformData: {},
      });
    const page = async (token: string) =>
      renderToStaticMarkup(
        await ConnectPage({
          params: Promise.resolve({ token }),
          searchParams: Promise.resolve({}),
        }),
      );

    it("page: no app and not public shows the not-available state and never builds an auth url", async () => {
      const spy = vi.spyOn(adapterFor("live", "tiktok"), "getAuthUrl");
      const s = await mk();
      const html = await page(s.token);
      expect(html).toContain("is not available on this PostPipe yet");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("callback: same check before the code exchange", async () => {
      const spy = vi.spyOn(adapterFor("live", "tiktok"), "exchangeCode");
      const s = await mk();
      const res = await GET(
        new Request(
          `http://localhost:3000/api/oauth/tiktok/callback?code=abc&state=${s.id}`,
        ),
        { params: Promise.resolve({ platform: "tiktok" }) },
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain(
        "reason=platform_not_available",
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("page: an org app lifts the gate", async () => {
      await upsertPlatformApp(orgId, "tiktok", {
        clientId: "org-key",
        clientSecret: "s",
        extra: null,
      });
      const spy = vi
        .spyOn(adapterFor("live", "tiktok"), "getAuthUrl")
        .mockResolvedValue({ url: "https://example.com/auth" });
      const s = await mk();
      const html = await page(s.token);
      expect(html).not.toContain("is not available on this PostPipe yet");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });
  },
);
