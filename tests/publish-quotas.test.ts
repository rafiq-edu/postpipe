import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mockAdapter } from "../lib/platforms/mock/adapter";
import type { PlatformAdapter } from "../lib/platforms/types";
import { precheck, utcDay } from "../lib/publish/quotas";
import { hasDb, testDb } from "./db";

describe.skipIf(!hasDb)("publish quotas precheck", () => {
  const acc = crypto.randomUUID();
  const scope = `account:${acc}`;
  const today = utcDay(new Date());
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  beforeAll(async () => {
    await (await testDb()).from("platform_quotas").delete().eq("scope", scope);
  });
  afterAll(async () => {
    await (await testDb()).from("platform_quotas").delete().eq("scope", scope);
  });

  it("allows, blocks at the cap, and allows a later day", async () => {
    expect(await precheck(mockAdapter, acc, null)).toEqual({ ok: true });
    const db = await testDb();
    const { error } = await db
      .from("platform_quotas")
      .insert({ scope, day: today, count: 100 });
    if (error) throw error;
    const r = await precheck(mockAdapter, acc, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violation.code).toBe("daily_quota_reached");
      expect(r.violation.earliest_at).toBe(tomorrow.toISOString());
    }
    expect(await precheck(mockAdapter, acc, tomorrow)).toEqual({ ok: true });
  });

  it("allows an adapter without quota", async () => {
    const noQuota = { ...mockAdapter, quota: undefined } as PlatformAdapter;
    expect(await precheck(noQuota, acc, null)).toEqual({ ok: true });
  });
});
