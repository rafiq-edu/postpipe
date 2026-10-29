import { afterEach, expect, test, vi } from "vitest";
import { getSecret, withSecretOverrides } from "../lib/secrets";

afterEach(() => vi.unstubAllEnvs());

test("returns env value", async () => {
  vi.stubEnv("SECRETS_SOURCE", "env");
  vi.stubEnv("FOO_KEY", "bar");
  expect(await getSecret("FOO_KEY")).toBe("bar");
});

test("throws MissingSecret with key name", async () => {
  vi.stubEnv("NOPE_KEY", "");
  await expect(getSecret("NOPE_KEY")).rejects.toThrow(
    "MissingSecret: NOPE_KEY, see docs/ops/keys-registry.md",
  );
});

test("aws source without STAGE throws MissingSecret STAGE", async () => {
  vi.stubEnv("SECRETS_SOURCE", "aws");
  vi.stubEnv("STAGE", "");
  await expect(getSecret("FOO_KEY")).rejects.toThrow(
    "MissingSecret: STAGE, see docs/ops/keys-registry.md",
  );
});

test("override wins inside withSecretOverrides and not outside", async () => {
  vi.stubEnv("SECRETS_SOURCE", "env");
  vi.stubEnv("X_CLIENT_ID", "global");
  const inside = await withSecretOverrides({ X_CLIENT_ID: "org" }, () =>
    getSecret("X_CLIENT_ID"),
  );
  expect(inside).toBe("org");
  expect(await getSecret("X_CLIENT_ID")).toBe("global");
});

test("concurrent overrides stay separate", async () => {
  vi.stubEnv("SECRETS_SOURCE", "env");
  vi.stubEnv("X_CLIENT_ID", "global");
  const slow = async () => {
    await new Promise((r) => setTimeout(r, 10));
    return getSecret("X_CLIENT_ID");
  };
  const [a, b] = await Promise.all([
    withSecretOverrides({ X_CLIENT_ID: "a" }, slow),
    withSecretOverrides({ X_CLIENT_ID: "b" }, slow),
  ]);
  expect([a, b]).toEqual(["a", "b"]);
});

test("falls through to env for names not overridden", async () => {
  vi.stubEnv("SECRETS_SOURCE", "env");
  vi.stubEnv("FOO_KEY", "bar");
  expect(
    await withSecretOverrides({ X_CLIENT_ID: "org" }, () =>
      getSecret("FOO_KEY"),
    ),
  ).toBe("bar");
});

test("empty override inside an org store does not inherit that store", async () => {
  vi.stubEnv("SECRETS_SOURCE", "env");
  vi.stubEnv("X_CLIENT_ID", "global");
  const got = await withSecretOverrides({ X_CLIENT_ID: "org" }, () =>
    withSecretOverrides({}, () => getSecret("X_CLIENT_ID")),
  );
  expect(got).toBe("global");
});

test("override with empty value masks the env secret", async () => {
  vi.stubEnv("SECRETS_SOURCE", "env");
  vi.stubEnv("META_LOGIN_CONFIG_ID", "global-cfg");
  await expect(
    withSecretOverrides({ META_LOGIN_CONFIG_ID: "" }, () =>
      getSecret("META_LOGIN_CONFIG_ID"),
    ),
  ).rejects.toThrow("MissingSecret: META_LOGIN_CONFIG_ID");
});
