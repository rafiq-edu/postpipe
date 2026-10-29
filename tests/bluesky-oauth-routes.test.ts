import { JoseKey } from "@atproto/oauth-client-node";
import { beforeAll, describe, expect, it } from "vitest";
import { resetBlueskyOAuthClient } from "../lib/connect/bluesky-oauth";

async function load() {
  resetBlueskyOAuthClient();
  return {
    meta: await import("../app/oauth/client-metadata.json/route"),
    jwks: await import("../app/oauth/jwks.json/route"),
  };
}

beforeAll(async () => {
  process.env.SECRETS_SOURCE = "env";
  const key = await JoseKey.generate(["ES256"], "k1");
  process.env.BLUESKY_OAUTH_PRIVATE_JWK = JSON.stringify(key.privateJwk);
});

describe("confidential mode (https app url)", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  });

  it("serves the exact client metadata", async () => {
    const { meta } = await load();
    const res = meta.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      client_id: "https://app.example.com/oauth/client-metadata.json",
      client_name: "PostPipe",
      scope: "atproto transition:generic",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      dpop_bound_access_tokens: true,
      jwks_uri: "https://app.example.com/oauth/jwks.json",
      redirect_uris: ["https://app.example.com/api/oauth/bluesky/callback"],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
    });
  });

  it("jwks has the public key and never a private field", async () => {
    const { jwks } = await load();
    const res = await jwks.GET();
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].kid).toBe("k1");
    expect(JSON.stringify(body)).not.toMatch(/"d"\s*:/);
  });
});

describe("loopback mode (http localhost)", () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  it("answers 404 on both routes", async () => {
    const { meta, jwks } = await load();
    expect(meta.GET().status).toBe(404);
    expect((await jwks.GET()).status).toBe(404);
  });
});
