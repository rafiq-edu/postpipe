import { beforeEach, describe, expect, it, vi } from "vitest";

const createEndpoint = vi.fn();
const assertPublicUrl = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/queries/orgs", () => ({
  getCurrentOrg: async () => ({ orgId: "org", role: "owner" }),
}));
vi.mock("@/lib/db/queries/webhooks", () => ({
  createEndpoint: (...a: unknown[]) => createEndpoint(...a),
  deleteEndpoint: vi.fn(),
  replayDelivery: vi.fn(),
}));
vi.mock("@/lib/webhooks/url-guard", () => ({
  assertPublicUrl: (...a: unknown[]) => assertPublicUrl(...a),
}));

import { createEndpointAction } from "../app/(dashboard)/dashboard/webhooks/actions";

const form = (url: string) => {
  const f = new FormData();
  f.set("url", url);
  f.set("mode", "test");
  f.append("events", "social.post.created");
  return f;
};

describe("createEndpointAction", () => {
  beforeEach(() => {
    createEndpoint.mockReset();
    assertPublicUrl.mockReset();
  });

  it("blocks a non-public url and does not create", async () => {
    assertPublicUrl.mockRejectedValue(new Error("blocked"));
    const r = await createEndpointAction({}, form("http://127.0.0.1/x"));
    expect(r).toEqual({ error: "url must resolve to a public address" });
    expect(createEndpoint).not.toHaveBeenCalled();
  });

  it("creates for a public url", async () => {
    assertPublicUrl.mockResolvedValue(undefined);
    createEndpoint.mockResolvedValue({ secret: "whsec_x" });
    const r = await createEndpointAction(
      {},
      form("http://hooks.example.com/x"),
    );
    expect(r).toEqual({ secret: "whsec_x" });
  });
});
