import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateAuthUrlSchema } from "../lib/api/schemas/social-accounts";
import { CreateWebhookEndpointSchema } from "../lib/api/schemas/webhooks";

const writes = vi.fn();
const id = "6f1c1c3e-6b1e-4b57-9c58-0d6a5f1a2b3c";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db/queries/orgs", () => ({
  getCurrentOrg: async () => ({ orgId: "org", role: "member" }),
}));
vi.mock("@/lib/db/queries/api-keys", () => ({
  createApiKey: (...a: unknown[]) => writes(...a),
  revokeApiKey: (...a: unknown[]) => writes(...a),
}));
vi.mock("@/lib/db/queries/webhooks", () => ({
  createEndpoint: (...a: unknown[]) => writes(...a),
  deleteEndpoint: (...a: unknown[]) => writes(...a),
  replayDelivery: (...a: unknown[]) => writes(...a),
}));
vi.mock("@/lib/db/queries/social-accounts", () => ({
  disconnectAccount: (...a: unknown[]) => writes(...a),
}));
vi.mock("@/lib/billing/provider", () => ({
  billingProvider: () => ({
    createCheckout: (...a: unknown[]) => writes(...a),
  }),
}));
vi.mock("@/lib/webhooks/url-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  createServiceClient: (...a: unknown[]) => writes(...a),
}));
vi.mock("@/lib/media/s3", () => ({
  putObject: (...a: unknown[]) => writes(...a),
  deleteObject: (...a: unknown[]) => writes(...a),
}));

import { disconnectAccountAction } from "../app/(dashboard)/dashboard/accounts/actions";
import { startCheckout } from "../app/(dashboard)/dashboard/billing/actions";
import {
  createKey,
  revokeKey,
} from "../app/(dashboard)/dashboard/keys/actions";
import { saveBrandingAction } from "../app/(dashboard)/dashboard/settings/branding-actions";
import {
  createEndpointAction,
  deleteEndpointAction,
  replayDeliveryAction,
} from "../app/(dashboard)/dashboard/webhooks/actions";

const form = () => {
  const f = new FormData();
  f.set("id", id);
  f.set("name", "k");
  f.set("plan", "builder");
  f.set("url", "https://example.com/h");
  f.append("events", "social.post.created");
  return f;
};

describe("members cannot write from the dashboard", () => {
  beforeEach(() => writes.mockClear());

  it("state actions return an error", async () => {
    expect(await createKey({}, form())).toEqual({
      error: "Only the owner can do this",
    });
    expect(await createEndpointAction({}, form())).toEqual({
      error: "Only the owner can do this",
    });
    expect(await saveBrandingAction({}, form())).toHaveProperty("error");
  });

  it("void actions throw", async () => {
    for (const fn of [
      revokeKey,
      deleteEndpointAction,
      replayDeliveryAction,
      disconnectAccountAction,
      startCheckout,
    ])
      await expect(fn(form())).rejects.toThrow("owner only");
  });

  it("nothing was written", () => expect(writes).not.toHaveBeenCalled());
});

describe("url schemes", () => {
  it("rejects non-http urls", () => {
    for (const url of ["javascript:alert(1)", "ftp://x"]) {
      expect(
        CreateWebhookEndpointSchema.safeParse({
          url,
          events: ["social.post.created"],
        }).success,
      ).toBe(false);
      expect(
        CreateAuthUrlSchema.safeParse({
          platform: "bluesky",
          external_id: "a",
          redirect_url: url,
        }).success,
      ).toBe(false);
    }
  });
});
