import { describe, expect, it } from "vitest";
import {
  msToNextMidnight,
  nextMidnight,
  quotaDay,
} from "../lib/publish/quota-day";

const LA = "America/Los_Angeles";

describe("quota day", () => {
  it("no zone = UTC, same as before", () => {
    expect(quotaDay(new Date("2026-05-01T23:59:59Z"))).toBe("2026-05-01");
    expect(nextMidnight("2026-05-01")).toBe("2026-05-02T00:00:00.000Z");
  });
  it("Pacific day changes at 07:00Z in summer and 08:00Z in winter", () => {
    expect(quotaDay(new Date("2026-07-01T06:59:59Z"), LA)).toBe("2026-06-30");
    expect(quotaDay(new Date("2026-07-01T07:00:00Z"), LA)).toBe("2026-07-01");
    expect(quotaDay(new Date("2026-01-01T07:59:59Z"), LA)).toBe("2025-12-31");
    expect(quotaDay(new Date("2026-01-01T08:00:00Z"), LA)).toBe("2026-01-01");
  });
  it("next midnight follows the DST change", () => {
    expect(nextMidnight("2026-03-07", LA)).toBe("2026-03-08T08:00:00.000Z"); // still PST
    expect(nextMidnight("2026-03-08", LA)).toBe("2026-03-09T07:00:00.000Z"); // spring forward day: PDT after
    expect(nextMidnight("2026-10-31", LA)).toBe("2026-11-01T07:00:00.000Z"); // PDT
    expect(nextMidnight("2026-11-01", LA)).toBe("2026-11-02T08:00:00.000Z"); // fall back day: PST after
  });
  it("midnight that does not exist (DST jumps at 24:00): first instant of the next day", () => {
    // Santiago 2026-09-05 24:00 -> 01:00 on 09-06 (-04 to -03), so 01:00 local = 04:00Z
    expect(nextMidnight("2026-09-05", "America/Santiago")).toBe(
      "2026-09-06T04:00:00.000Z",
    );
    expect(quotaDay(new Date("2026-09-06T04:00:00Z"), "America/Santiago")).toBe(
      "2026-09-06",
    );
  });
  it("offsets that are not whole hours", () => {
    expect(nextMidnight("2026-01-01", "Asia/Kathmandu")).toBe(
      "2026-01-01T18:15:00.000Z",
    );
    expect(nextMidnight("2026-01-01", "Australia/Adelaide")).toBe(
      "2026-01-01T13:30:00.000Z",
    );
    expect(nextMidnight("2026-07-01", "Australia/Adelaide")).toBe(
      "2026-07-01T14:30:00.000Z",
    );
  });
  it("ms to next midnight", () => {
    expect(msToNextMidnight(new Date("2026-07-01T06:00:00Z"), LA)).toBe(
      3_600_000,
    );
    expect(msToNextMidnight(new Date("2026-07-01T23:00:00Z"))).toBe(3_600_000);
  });
});
