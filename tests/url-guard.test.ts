import { beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns", () => ({
  promises: { lookup: (...a: unknown[]) => lookup(...a) },
}));

import { assertPublicUrl, isBlockedAddress } from "../lib/webhooks/url-guard";

describe("isBlockedAddress", () => {
  const blocked = [
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "::ffff:127.0.0.1",
    "::ffff:10.1.2.3",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:169.254.169.254",
  ];
  const open = [
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.0.1",
    "172.32.0.1",
    "198.17.0.1",
    "198.20.0.1",
    "223.255.255.255",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
    "fec0::1",
  ];
  it.each(blocked)("blocks %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(open)("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  beforeEach(() => lookup.mockReset());
  it("rejects localhost names and blocked literals without lookup", async () => {
    for (const u of [
      "http://localhost/x",
      "http://a.localhost/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/x",
      "http://[::1]/x",
      "http://[::ffff:10.0.0.1]/x",
    ])
      await expect(assertPublicUrl(u)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
  it("rejects when any resolved address is blocked", async () => {
    lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(assertPublicUrl("https://h.example/x")).rejects.toThrow();
  });
  it("allows a public host", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      assertPublicUrl("https://h.example/x"),
    ).resolves.toBeUndefined();
  });
});
