// Load and lateness benchmark (Task 34). Needs local Supabase and `docker compose up -d --build --scale worker=2`.
// Run: pnpm load:test   Optional: LOAD_POSTS (default 1000).
import { randomUUID } from "node:crypto";
import { encryptToken } from "../lib/crypto/tokens";
import { createServiceClient } from "../lib/db/client";
import { insertPost, insertTargets } from "../lib/db/queries/social-posts";
import type { AccountForPublish } from "../lib/publish/validate";

const POSTS = Number(process.env.LOAD_POSTS ?? 1000);
const ACCOUNTS = 10;
const DEADLINE_MS = 15 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

async function main() {
  const db = await createServiceClient();
  const { data: org, error } = await db
    .from("organizations")
    .insert({ name: "task34-load", plan: "scale" })
    .select("id")
    .single();
  if (error) throw error;
  try {
    const accounts: AccountForPublish[] = [];
    for (let i = 0; i < ACCOUNTS; i++) {
      const { data, error: e } = await db
        .from("social_accounts")
        .insert({
          org_id: org.id,
          mode: "live",
          platform: "mock",
          external_id: `load-${i}`,
          platform_user_id: randomUUID(),
          status: "connected",
          access_token_enc: await encryptToken("access"),
          refresh_token_enc: await encryptToken("refresh"),
          token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .select(
          "id, org_id, mode, platform, external_id, platform_user_id, status, platform_data, deleted_at",
        )
        .single();
      if (e) throw e;
      accounts.push(data);
    }
    // Start of the next full minute, plus one minute, so seeding finishes first.
    const at = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 120_000);
    console.log(`seeding ${POSTS} posts for ${at.toISOString()}`);
    let next = 0;
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        while (next < POSTS) {
          const n = next++;
          const acc = accounts[n % ACCOUNTS];
          const post = await insertPost({
            org_id: org.id,
            mode: "live",
            caption: `load ${n}`,
            media_ids: [],
            media: [],
            social_account_ids: [acc.id],
            platform_configurations: {},
            account_configurations: [],
            scheduled_at: at.toISOString(),
            status: "scheduled",
          });
          await insertTargets(post, [acc], at);
        }
      }),
    );
    console.log("seeded, waiting for workers");
    const start = Date.now();
    let rows: { status: string; published_at: string | null }[] = [];
    while (
      Date.now() - start <
      DEADLINE_MS + Math.max(0, at.getTime() - start)
    ) {
      const { data, error: e } = await db
        .from("social_post_targets")
        .select("status, published_at")
        .eq("org_id", org.id)
        .limit(POSTS + 1);
      if (e) throw e;
      rows = data;
      const open = rows.filter(
        (r) => r.status === "pending" || r.status === "running",
      ).length;
      if (Date.now() > at.getTime()) console.log(`open: ${open}`);
      if (open === 0 && rows.length === POSTS) break;
      await sleep(5000);
    }
    const drainMs = Date.now() - at.getTime();
    const late = rows
      .filter((r) => r.status === "success" && r.published_at)
      .map((r) => new Date(r.published_at as string).getTime() - at.getTime())
      .sort((a, b) => a - b);
    const bad = rows.length - late.length;
    const s = (ms: number) => (ms / 1000).toFixed(1);
    console.log(
      JSON.stringify({
        posts: POSTS,
        published: late.length,
        not_published: bad,
        error_rate: bad / POSTS,
        p50_s: s(percentile(late, 0.5)),
        p95_s: s(percentile(late, 0.95)),
        max_s: s(late[late.length - 1]),
        drain_s: s(drainMs),
      }),
    );
  } finally {
    await db.from("organizations").delete().eq("id", org.id);
  }
}

await main();
