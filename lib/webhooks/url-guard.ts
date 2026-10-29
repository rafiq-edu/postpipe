import { promises as dns } from "node:dns";
import { isIP } from "node:net";

function v4Bytes(ip: string): number[] {
  return ip.split(".").map(Number);
}

function blockedV4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expand an IPv6 string to 16 bytes. Input must pass isIP === 6. */
function v6Bytes(ip: string): number[] {
  let s = ip.split("%")[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = v4Bytes(tail[1]);
    s =
      s.slice(0, -tail[1].length) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const h = head ? head.split(":") : [];
  const r = rest === undefined ? [] : rest ? rest.split(":") : [];
  const groups = [
    ...h,
    ...(rest === undefined ? [] : Array(8 - h.length - r.length).fill("0")),
    ...r,
  ].map((g) => Number.parseInt(g, 16));
  return groups.flatMap((g) => [g >> 8, g & 255]);
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blockedV4(v4Bytes(ip));
  if (kind !== 6) return true; // not an IP: refuse
  const b = v6Bytes(ip);
  const leadZero = b.slice(0, 10).every((x) => x === 0);
  if (leadZero && b[10] === 0xff && b[11] === 0xff)
    return blockedV4(b.slice(12));
  if (b.slice(0, 15).every((x) => x === 0) && b[15] <= 1) return true; // :: and ::1
  return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80);
}

export async function assertPublicUrl(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost"))
    throw new Error("host is localhost");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("address is not public");
    return;
  }
  const res = await dns.lookup(host, { all: true });
  if (res.length === 0 || res.some((r) => isBlockedAddress(r.address)))
    throw new Error("host resolves to a non-public address");
}
