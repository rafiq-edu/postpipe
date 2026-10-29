import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { youtubeAdapter } from "../lib/platforms/youtube/adapter";
import { quotaDay } from "../lib/publish/quota-day";
import {
  precheck,
  quotaScope,
  recordReportedUsage,
} from "../lib/publish/quotas";
import { hasDb, testDb } from "./db";

// Year 2098: own far-future day, nothing else touches these counters.
const when = new Date("2098-05-05T18:00:00Z");
const day = quotaDay(when, youtubeAdapter.quota?.timeZone);
const byo = { byo_client_id: "client-byo" };

describe("project quota scope", () => {
  it("BYO accounts count under their own client id, global accounts keep project:youtube", () => {
    const id = randomUUID();
    expect(quotaScope(youtubeAdapter, id)).toBe("project:youtube");
    expect(quotaScope(youtubeAdapter, id, {})).toBe("project:youtube");
    expect(quotaScope(youtubeAdapter, id, byo)).toBe(
      "project:youtube:client-byo",
    );
  });
});

describe.skipIf(!hasDb)("project quota isolation", () => {
  afterAll(async () => {
    await (await testDb())
      .from("platform_quotas")
      .delete()
      .eq("day", day)
      .in("scope", ["project:youtube", "project:youtube:client-byo"]);
  });

  it("BYO usage does not move the global counter and vice versa", async () => {
    const id = randomUUID();
    const cap = youtubeAdapter.quota?.dailyCap ?? 100;
    await recordReportedUsage(
      quotaScope(youtubeAdapter, id, byo) as string,
      day,
      cap,
    );
    expect((await precheck(youtubeAdapter, id, when, undefined, byo)).ok).toBe(
      false,
    );
    expect((await precheck(youtubeAdapter, id, when)).ok).toBe(true);

    const db = await testDb();
    await db
      .from("platform_quotas")
      .delete()
      .eq("day", day)
      .eq("scope", "project:youtube:client-byo");
    await recordReportedUsage("project:youtube", day, cap);
    expect((await precheck(youtubeAdapter, id, when)).ok).toBe(false);
    expect((await precheck(youtubeAdapter, id, when, undefined, byo)).ok).toBe(
      true,
    );
  });
});
