import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@/lib/api/errors";
import { CreateSocialPostSchema, ProblemSchema } from "@/lib/api/schemas";

const acct = "6f1c2b9e-1d3a-4c5e-8f70-123456789abc";
const base = { caption: "hi", social_accounts: [acct] };
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const DAY = 86_400_000;

describe("CreateSocialPostSchema", () => {
  it("rejects empty social_accounts", () => {
    expect(
      CreateSocialPostSchema.safeParse({ ...base, social_accounts: [] })
        .success,
    ).toBe(false);
  });
  it("rejects scheduled_at in the past", () => {
    expect(
      CreateSocialPostSchema.safeParse({
        ...base,
        scheduled_at: at(-3_600_000),
      }).success,
    ).toBe(false);
  });
  it("rejects scheduled_at 91 days ahead", () => {
    expect(
      CreateSocialPostSchema.safeParse({ ...base, scheduled_at: at(91 * DAY) })
        .success,
    ).toBe(false);
  });
  it("accepts scheduled_at 1 day ahead", () => {
    expect(
      CreateSocialPostSchema.safeParse({ ...base, scheduled_at: at(DAY) })
        .success,
    ).toBe(true);
  });
  it("rejects unknown platform key, accepts mock", () => {
    const bad = CreateSocialPostSchema.safeParse({
      ...base,
      platform_configurations: { myspace: {} },
    });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toMatch(/unrecognized key/i);
    expect(
      CreateSocialPostSchema.safeParse({
        ...base,
        platform_configurations: { mock: { fail: true } },
      }).success,
    ).toBe(true);
  });
  it("rejects an empty post", () => {
    expect(
      CreateSocialPostSchema.safeParse({ caption: "", social_accounts: [acct] })
        .success,
    ).toBe(false);
  });
});

describe("errors", () => {
  it("ERROR_CODES has no duplicates", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
  it("ProblemSchema accepts a problem", () => {
    expect(
      ProblemSchema.safeParse({
        type: "t",
        title: "T",
        status: 401,
        detail: "d",
        code: "missing_api_key",
      }).success,
    ).toBe(true);
  });
});
