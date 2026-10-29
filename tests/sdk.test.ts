// Runs the generated TypeScript SDK (sdks/typescript, made by `pnpm sdk:generate`)
// against a Next dev server that this test starts on its own port.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApiKey } from "../lib/api/auth";
import { publishTarget } from "../lib/publish/steps";
import { hasDb, testDb } from "./db";

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;

describe.skipIf(!existsSync("sdks/typescript") || !hasDb)(
  "TypeScript SDK golden path",
  () => {
    let server: ChildProcess;
    let orgId = "";
    let key = "";

    beforeAll(async () => {
      const db = await testDb();
      const org = await db
        .from("organizations")
        .insert({ name: "sdk-test", plan: "free" })
        .select("id")
        .single();
      if (org.error) throw org.error;
      orgId = org.data.id;
      const k = generateApiKey("test");
      const ins = await db.from("api_keys").insert({
        org_id: orgId,
        name: "sdk",
        key_hash: k.hash,
        key_prefix: k.prefix,
        last4: k.last4,
        mode: "test",
      });
      if (ins.error) throw ins.error;
      key = k.plaintext;

      // NEXT_PUBLIC_APP_URL makes the connect URLs point at this server, not :3000.
      server = spawn("pnpm", ["exec", "next", "dev", "-p", String(PORT)], {
        env: {
          ...process.env,
          NEXT_PUBLIC_APP_URL: BASE,
          NEXT_DIST_DIR: ".next-sdk-test",
        },
        stdio: "ignore",
      });
      const deadline = Date.now() + 90_000;
      for (;;) {
        const up = await fetch(`${BASE}/api/health`).then(
          (r) => r.ok,
          () => false,
        );
        if (up) break;
        if (Date.now() > deadline) throw new Error("dev server did not start");
        await new Promise((r) => setTimeout(r, 500));
      }
    }, 120_000);

    afterAll(async () => {
      server?.kill("SIGTERM");
      if (orgId) {
        const db = await testDb();
        await db.from("organizations").delete().eq("id", orgId);
      }
    });

    it("connects a mock account, posts, and the worker publishes it", async () => {
      // Variable path: the generated SDK is git-ignored, so tsc must not need it.
      const sdkPath = "../sdks/typescript/index";
      const { PostpipeApiClient } = await import(/* @vite-ignore */ sdkPath);
      const client = new PostpipeApiClient({
        token: key,
        baseUrl: `${BASE}/v1`,
      });

      const auth = await client.socialAccounts.createAuthUrl({
        platform: "mock",
        external_id: "sdk-user",
        redirect_url: `${BASE}/privacy`,
        platform_data: { target_id: "page-1" },
      });

      // Mock connect: open the hosted page, follow "continue" to the callback.
      const html = await (await fetch(auth.url)).text();
      const href = /href="([^"]+)"[^>]*data-testid="connect-continue"/.exec(
        html,
      )?.[1];
      expect(href).toBeTruthy();
      const cb = await fetch((href as string).replaceAll("&amp;", "&"), {
        redirect: "manual",
      });
      const accountId = new URL(
        cb.headers.get("location") ?? "",
      ).searchParams.get("account_id");
      expect(accountId).toBeTruthy();

      const post = await client.socialPosts.createSocialPost({
        "Idempotency-Key": `sdk-${Date.now()}`,
        caption: "hello from the SDK",
        social_accounts: [accountId as string],
        scheduled_at: new Date().toISOString(),
      });

      // Publish only our own target: a worker tick would claim every due row in the shared DB.
      const db = await testDb();
      const { data: row, error } = await db
        .from("social_post_targets")
        .select("*")
        .eq("post_id", post.id)
        .single();
      if (error) throw error;
      await publishTarget(row, { now: new Date() });
      const results = await client.socialPosts.listSocialPostResults({
        post_id: post.id,
      });
      const status = results.data[0]?.status ?? "pending";
      expect(status).toBe("success");
    }, 120_000);
  },
);
