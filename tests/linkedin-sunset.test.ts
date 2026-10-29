import { describe, expect, it } from "vitest";
import { linkedinSunset } from "../lib/platforms/linkedin/version";

const S = "2027-10-01";
describe("linkedinSunset", () => {
  it("ok when more than 30 days remain", () => {
    expect(linkedinSunset(new Date("2027-08-01T00:00:00Z"), S).state).toBe(
      "ok",
    );
  });
  it("soon at exactly 30 days and when 1 day remains", () => {
    expect(linkedinSunset(new Date("2027-09-01T00:00:00Z"), S)).toEqual({
      state: "soon",
      daysLeft: 30,
    });
    expect(linkedinSunset(new Date("2027-09-30T00:00:00Z"), S).state).toBe(
      "soon",
    );
  });
  it("past after the date", () => {
    expect(linkedinSunset(new Date("2027-10-01T00:00:01Z"), S).state).toBe(
      "past",
    );
  });
});
