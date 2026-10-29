import { beforeEach, describe, expect, it, vi } from "vitest";

const session: Record<string, unknown> = {};
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const authorize = vi.fn();
const callback = vi.fn();
const save = vi.fn();
const release = vi.fn(async (..._a: unknown[]) => {});
let claimed = false;
let open = true;

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("@/lib/db/queries/connect-sessions", () => ({
  findConnectSessionByToken: async () => session,
  findConnectSessionById: async (id: string) =>
    id === session.id ? session : null,
  sessionIsOpen: () => open,
  claimConnectSession: async () => {
    if (claimed) return false;
    claimed = true;
    return true;
  },
  MAX_CONNECT_FAILURES: 5,
  recordConnectFailure: async () => 1,
}));
vi.mock("@/lib/connect/save-account", () => ({
  saveConnectedAccount: (...a: unknown[]) => save(...a),
}));
vi.mock("@/lib/log/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/lib/platforms/bluesky/adapter", () => ({
  blueskyAdapter: {
    getProfile: async () => ({
      platformUserId: "did:plc:a",
      username: "a.test",
      displayName: "A",
    }),
  },
}));
vi.mock("@/lib/connect/bluesky-oauth", () => ({
  getBlueskyOAuthClient: async () => ({
    authorize: (...a: unknown[]) => authorize(...a),
    callback: (...a: unknown[]) => callback(...a),
  }),
  releaseBlueskyDid: (...a: unknown[]) => release(...a),
  blueskyOAuthMarker: (d: string) => `oauth:${d}`,
}));

import { OAuthCallbackError } from "@atproto/oauth-client-node";
import { GET } from "../app/api/oauth/bluesky/callback/route";
import { startBlueskyOAuth } from "../app/connect/[token]/actions";

const ID = "11111111-1111-4111-8111-111111111111";
const form = (handle = "a.test") => {
  const f = new FormData();
  f.set("handle", handle);
  return f;
};
const start = () =>
  startBlueskyOAuth("tok", form()).then(
    () => "",
    (e: Error) => e.message,
  );
const cb = () =>
  GET(
    new Request(
      "https://app.example.com/api/oauth/bluesky/callback?state=k&code=c",
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  claimed = false;
  open = true;
  for (const k of Object.keys(session)) delete session[k];
  Object.assign(session, {
    id: ID,
    platform: "bluesky",
    mode: "live",
    redirect_url: "https://app.example.com/done",
    platform_data: {},
  });
});

describe("startBlueskyOAuth", () => {
  it("rejects wrong platform, test mode, closed and app-password-only sessions", async () => {
    for (const patch of [
      { platform: "x" },
      { mode: "test" },
      { platform_data: { auth: "app_password" } },
    ]) {
      Object.assign(session, patch);
      expect(await start()).toBe("REDIRECT:/connect/tok");
      Object.assign(session, {
        platform: "bluesky",
        mode: "live",
        platform_data: {},
      });
    }
    open = false;
    expect(await start()).toBe("REDIRECT:/connect/tok");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("redirects to the url from the client, with the session id as state", async () => {
    authorize.mockResolvedValue(
      new URL("https://bsky.social/oauth/authorize?x=1"),
    );
    expect(await start()).toBe(
      "REDIRECT:https://bsky.social/oauth/authorize?x=1",
    );
    expect(authorize).toHaveBeenCalledWith("a.test", { state: ID });
  });

  it("a handle that cannot be resolved goes back with ?error=handle", async () => {
    authorize.mockRejectedValue(new Error("boom with details"));
    expect(await start()).toBe("REDIRECT:/connect/tok?error=handle");
  });
});

describe("oauth callback", () => {
  const ok = () =>
    callback.mockResolvedValue({
      state: ID,
      session: {
        did: "did:plc:a",
        getTokenInfo: async () => ({ aud: "https://pds.example.com" }),
      },
    });

  it("saves an oauth account and claims the session once", async () => {
    ok();
    save.mockResolvedValue({ ok: true, row: { id: "acc1" } });
    const res = await cb();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("status=success");
    const [, tokens] = save.mock.calls[0];
    expect(tokens.platformData).toEqual({
      auth: "oauth",
      did: "did:plc:a",
      pds: "https://pds.example.com",
      handle: "a.test",
    });
    expect(tokens.accessToken).toBe("oauth:did:plc:a");
    expect((await cb()).status).toBe(410);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("an unknown or used state fails", async () => {
    callback.mockRejectedValue(new Error("gone"));
    expect((await cb()).status).toBe(400);
  });

  it("a claim that fails drops the stored session", async () => {
    ok();
    claimed = true;
    expect((await cb()).status).toBe(410);
    expect(release).toHaveBeenCalledWith("did:plc:a");
  });

  it("an access_denied callback redirects with reason=oauth and no library text", async () => {
    const params = new URLSearchParams("error=access_denied&state=k");
    callback.mockRejectedValue(
      new OAuthCallbackError(params, "secret library text", ID),
    );
    const res = await cb();
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("status=error");
    expect(loc).toContain("reason=oauth");
    expect(loc).not.toContain("secret");
  });
});
