// Pure helpers (no DB) so adapters can compute the next quota reset. Absent tz = UTC.

type Parts = Record<string, number>;

function local(ms: number, tz: string): Parts {
  const out: Parts = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms)))
    if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day (YYYY-MM-DD) of `d` in `tz` (IANA name). */
export function quotaDay(d: Date, tz?: string): string {
  if (!tz || tz === "UTC") return d.toISOString().slice(0, 10);
  const p = local(d.getTime(), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Instant (ISO, UTC) when the day after `day` starts in `tz`. */
export function nextMidnight(day: string, tz?: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  if (!tz || tz === "UTC") return d.toISOString();
  const wall = d.getTime();
  const offset = (at: number) => {
    const p = local(at, tz);
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at
    );
  };
  // Two passes settle the offset when it changes near the guess (DST).
  const first = wall - offset(wall);
  const out = new Date(wall - offset(first)).toISOString();
  // Midnight may not exist (DST jumps at 24:00): then the first instant of the next day is `first`.
  return quotaDay(new Date(out), tz) === d.toISOString().slice(0, 10)
    ? out
    : new Date(first).toISOString();
}

/** Milliseconds from `now` to the next quota reset in `tz`. */
export const msToNextMidnight = (now: Date, tz?: string): number =>
  Math.max(0, Date.parse(nextMidnight(quotaDay(now, tz), tz)) - now.getTime());
