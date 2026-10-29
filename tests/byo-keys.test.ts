import { expect, test } from "vitest";
import {
  isByoPlatform,
  PlatformAppInputSchema,
  toSecretOverrides,
} from "../lib/platforms/byo-keys";

test("maps x to two env names", () => {
  expect(
    toSecretOverrides("x", {
      clientId: "id",
      clientSecret: "sec",
      extra: null,
    }),
  ).toEqual({
    X_CLIENT_ID: "id",
    X_CLIENT_SECRET: "sec",
  });
});

test("maps facebook extra to META_LOGIN_CONFIG_ID and masks it with empty string when null", () => {
  expect(
    toSecretOverrides("facebook", {
      clientId: "1",
      clientSecret: "2",
      extra: "cfg",
    }),
  ).toEqual({
    META_APP_ID: "1",
    META_APP_SECRET: "2",
    META_LOGIN_CONFIG_ID: "cfg",
  });
  expect(
    toSecretOverrides("facebook", {
      clientId: "1",
      clientSecret: "2",
      extra: null,
    }),
  ).toEqual({
    META_APP_ID: "1",
    META_APP_SECRET: "2",
    META_LOGIN_CONFIG_ID: "",
  });
});

test("PlatformAppInputSchema rejects blank secret", () => {
  expect(
    PlatformAppInputSchema.safeParse({
      platform: "x",
      client_id: "a",
      client_secret: "   ",
    }).success,
  ).toBe(false);
});

test("PlatformAppInputSchema rejects bluesky and mock", () => {
  for (const platform of ["bluesky", "mock"])
    expect(
      PlatformAppInputSchema.safeParse({
        platform,
        client_id: "a",
        client_secret: "b",
      }).success,
    ).toBe(false);
});

test("isByoPlatform", () => {
  expect(isByoPlatform("tiktok")).toBe(true);
  expect(isByoPlatform("bluesky")).toBe(false);
});

test("facebook requires a non-blank extra, reported on the extra field", () => {
  for (const extra of [undefined, "", "   "]) {
    const r = PlatformAppInputSchema.safeParse({
      platform: "facebook",
      client_id: "a",
      client_secret: "b",
      extra,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["extra"]);
  }
  const ok = PlatformAppInputSchema.safeParse({
    platform: "facebook",
    client_id: "a",
    client_secret: "b",
    extra: " cfg ",
  });
  expect(ok.data?.extra).toBe("cfg");
});

test("other platforms drop extra", () => {
  const r = PlatformAppInputSchema.safeParse({
    platform: "x",
    client_id: "a",
    client_secret: "b",
    extra: "junk",
  });
  expect(r.success).toBe(true);
  expect(r.data?.extra).toBeUndefined();
});
