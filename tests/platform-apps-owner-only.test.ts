import { expect, it, vi } from "vitest";

const writes = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/queries/orgs", () => ({
  getCurrentOrg: async () => ({ orgId: "org", role: "member" }),
}));
vi.mock("@/lib/db/queries/platform-apps", () => ({
  upsertPlatformApp: (...a: unknown[]) => writes(...a),
  deletePlatformApp: (...a: unknown[]) => writes(...a),
}));

import {
  removePlatformApp,
  savePlatformApp,
} from "../app/(dashboard)/dashboard/settings/platform-apps-actions";

it("a member cannot save or remove a platform app", async () => {
  const save = new FormData();
  save.set("platform", "x");
  save.set("client_id", "id");
  save.set("client_secret", "shh");
  const r1 = await savePlatformApp({ ok: false }, save);
  expect(r1).toEqual({
    ok: false,
    error: "Only the owner can change platform apps.",
  });
  expect(JSON.stringify(r1)).not.toContain("shh");
  const rm = new FormData();
  rm.set("platform", "x");
  expect((await removePlatformApp({ ok: false }, rm)).ok).toBe(false);
  expect(writes).not.toHaveBeenCalled();
});
