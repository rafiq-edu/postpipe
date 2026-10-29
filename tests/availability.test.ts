import { afterEach, expect, it, vi } from "vitest";
import { publicPlatforms } from "../lib/platforms/availability";

afterEach(() => vi.unstubAllEnvs());

it("defaults to bluesky, x, linkedin", () => {
  vi.stubEnv("PUBLIC_PLATFORMS", undefined);
  expect([...publicPlatforms()].sort()).toEqual(["bluesky", "linkedin", "x"]);
});

it("normalises case and spaces", () => {
  vi.stubEnv("PUBLIC_PLATFORMS", " X, LinkedIn ,");
  expect([...publicPlatforms()].sort()).toEqual(["linkedin", "x"]);
});
