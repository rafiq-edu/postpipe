import { describe, expect, it } from "vitest";
import { shouldSleep } from "../lib/publish/worker";

describe("worker drain rule", () => {
  it("does not sleep after a full batch", () => {
    expect(shouldSleep(5, 5)).toBe(false);
  });
  it("sleeps after a partial or empty batch", () => {
    expect(shouldSleep(4, 5)).toBe(true);
    expect(shouldSleep(0, 5)).toBe(true);
  });
});
