import { beforeEach, describe, expect, it } from "vitest";
import { signPullPath, verifyPull } from "../lib/media/pull-url";

const NOW = 1_800_000_000;
const parts = (p: string) => p.split("/").slice(2) as [string, string, string];

beforeEach(() => {
  process.env.SECRETS_SOURCE = "env";
  process.env.MEDIA_URL_SIGNING_KEY = "test-signing-key";
});

describe("pull url signing", () => {
  it("signs then verifies", async () => {
    const [id, exp, sig] = parts(await signPullPath("m1", NOW + 3600));
    expect(id).toBe("m1");
    expect(await verifyPull(id, exp, sig, NOW)).toBe(true);
  });
  it("rejects a tampered id, exp or sig", async () => {
    const [id, exp, sig] = parts(await signPullPath("m1", NOW + 3600));
    expect(await verifyPull("m2", exp, sig, NOW)).toBe(false);
    expect(await verifyPull(id, String(Number(exp) + 1), sig, NOW)).toBe(false);
    expect(await verifyPull(id, exp, `${sig.slice(0, -1)}A`, NOW)).toBe(false);
    expect(await verifyPull(id, exp, "", NOW)).toBe(false);
  });
  it("rejects expired", async () => {
    const [id, exp, sig] = parts(await signPullPath("m1", NOW - 1));
    expect(await verifyPull(id, exp, sig, NOW)).toBe(false);
  });
  it("rejects exp more than 24h + 60s ahead, accepts the edge", async () => {
    const far = parts(await signPullPath("m1", NOW + 86_461));
    expect(await verifyPull(...far, NOW)).toBe(false);
    const edge = parts(await signPullPath("m1", NOW + 86_460));
    expect(await verifyPull(...edge, NOW)).toBe(true);
  });
  it("rejects a non-digit exp", async () => {
    const [id, , sig] = parts(await signPullPath("m1", NOW + 10));
    expect(await verifyPull(id, "1e10", sig, NOW)).toBe(false);
    expect(await verifyPull(id, "-5", sig, NOW)).toBe(false);
  });
  it("missing key: sign throws config_error, verify false", async () => {
    const ok = await signPullPath("m1", NOW + 10);
    delete process.env.MEDIA_URL_SIGNING_KEY;
    await expect(signPullPath("m1", NOW + 10)).rejects.toMatchObject({
      code: "config_error",
      kind: "permanent",
    });
    expect(await verifyPull(...parts(ok), NOW)).toBe(false);
  });
});
