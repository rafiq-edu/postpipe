import { createHash } from "node:crypto";

const B32 = "234567abcdefghijklmnopqrstuvwxyz";

/**
 * atproto TID: 13 chars base32-sortable of (0 bit, 53 bit microseconds, 10 bit clock id).
 * Same target gives the same rkey, so a retried createRecord cannot post twice.
 */
export function tidFor(targetId: string, createdAt: string): string {
  const h = createHash("sha256").update(targetId).digest();
  // Targets of one transaction share created_at (ms), so the hash also fills the low microseconds.
  const micros =
    BigInt(new Date(createdAt).getTime()) * BigInt(1000) +
    BigInt(h.readUInt32BE(2) % 1000);
  const clock = BigInt(h.readUInt16BE(0) & 1023);
  let n = (micros << BigInt(10)) | clock;
  let out = "";
  for (let k = 0; k < 13; k++) {
    out = B32[Number(n & BigInt(31))] + out;
    n >>= BigInt(5);
  }
  return out;
}
