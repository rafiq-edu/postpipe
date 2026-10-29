import { beforeEach, describe, expect, it, vi } from "vitest";

const PASSWORD = "secret-app-pass-1234";
const session = {
  id: "s1",
  platform: "bluesky",
  mode: "live",
  redirect_url: "https://app.example.com/done",
  failed_attempts: 0,
};
let fails = 0;
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const warn = vi.fn();
const login = vi.fn();
const save = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("@/lib/db/queries/connect-sessions", () => ({
  findConnectSessionByToken: async () => session,
  sessionIsOpen: () => true,
  claimConnectSession: async () => true,
  MAX_CONNECT_FAILURES: 5,
  recordConnectFailure: async () => ++fails,
}));
vi.mock("@/lib/connect/save-account", () => ({
  saveConnectedAccount: (...a: unknown[]) => save(...a),
}));
vi.mock("@/lib/log/logger", () => ({
  logger: { warn: (...a: unknown[]) => warn(...a) },
}));
vi.mock("@/lib/platforms/bluesky/app-password", () => ({
  loginWithAppPassword: (...a: unknown[]) => login(...a),
}));
vi.mock("@/lib/platforms/bluesky/adapter", () => ({
  blueskyAdapter: {
    getProfile: async () => ({
      platformUserId: "did:plc:a",
      username: "a",
      displayName: "A",
    }),
  },
}));

import { connectBlueskyAppPassword } from "../app/connect/[token]/actions";
import { PublishError } from "../lib/platforms/types";

const form = () => {
  const f = new FormData();
  f.set("handle", "a.example.com");
  f.set("app_password", PASSWORD);
  return f;
};
const run = () =>
  connectBlueskyAppPassword("tok", form()).then(
    () => "",
    (e: Error) => e.message,
  );

beforeEach(() => {
  vi.clearAllMocks();
  fails = 0;
  session.failed_attempts = 0;
});

describe("connectBlueskyAppPassword", () => {
  it("wrong password goes back with ?error=login and leaks nothing", async () => {
    login.mockRejectedValue(new PublishError("auth_failed", "auth", "bad"));
    const msg = await run();
    expect(msg).toBe("REDIRECT:/connect/tok?error=login");
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(redirect.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PASSWORD);
  });

  it("success saves the account and redirects with status=success", async () => {
    login.mockResolvedValue({ accessToken: "a", scopes: [] });
    save.mockResolvedValue({ ok: true, row: { id: "acc1" } });
    const msg = await run();
    expect(save).toHaveBeenCalledOnce();
    expect(msg).toContain("status=success");
    expect(msg).toContain("account_id=acc1");
    expect(msg).not.toContain(PASSWORD);
  });

  it("5 wrong passwords lock the session; the next try never reaches the platform", async () => {
    login.mockRejectedValue(new PublishError("auth_failed", "auth", "bad"));
    for (let n = 1; n <= 4; n++)
      expect(await run()).toBe("REDIRECT:/connect/tok?error=login");
    expect(await run()).toBe("REDIRECT:/connect/tok?error=locked");
    expect(login).toHaveBeenCalledTimes(5);
    session.failed_attempts = 5;
    expect(await run()).toBe("REDIRECT:/connect/tok?error=locked");
    expect(login).toHaveBeenCalledTimes(5);
  });

  it("bad input goes to ?error=login without calling the platform", async () => {
    const f = form();
    f.set("handle", "a");
    const msg = await connectBlueskyAppPassword("tok", f).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(msg).toBe("REDIRECT:/connect/tok?error=login");
    expect(login).not.toHaveBeenCalled();
  });
});
