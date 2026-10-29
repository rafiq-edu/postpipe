export const LINKEDIN_VERSION = "202610"; // linkedin.md section 4, "Version to pin today"
// ASSUMED from the 12 month policy; linkedin.md section 4 says the 202610 sunset is not published. UNVERIFIED.
export const LINKEDIN_VERSION_SUNSET_ASSUMED = "2027-10-01";

export const LINKEDIN_SUNSET_WARN_DAYS = 30;

/** Pure: days from `now` to the sunset date (UTC, rounded up). "soon" is 30 days or fewer, "past" is after the date. */
export function linkedinSunset(
  now: Date,
  sunset: string,
): { state: "ok" | "soon" | "past"; daysLeft: number } {
  const ms = new Date(sunset).getTime() - now.getTime();
  const daysLeft = Math.ceil(ms / 86_400_000);
  const state =
    ms < 0 ? "past" : daysLeft <= LINKEDIN_SUNSET_WARN_DAYS ? "soon" : "ok";
  return { state, daysLeft };
}
