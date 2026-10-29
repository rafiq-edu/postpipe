export const SECRET_KEY_RE =
  /token|secret|authorization|password|cookie|_enc$/i;
export const SECRET_VALUE_RES = [
  /\bpp_(live|test)_[A-Za-z0-9]{32}/g,
  /\bBearer\s+\S+/gi,
  /\bv\d+\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22,}/g,
  /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bTH(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g, // Threads access tokens start with TH; needs a lowercase letter and a digit so THREADS_API__X codes pass
  /\bIG(AA|QV)[A-Za-z0-9_-]{20,}/g, // Instagram access tokens (prefix UNVERIFIED in instagram.md)
  /\b(ya29\.|EAA|sk_|whsec_)[A-Za-z0-9_.-]{16,}/g,
];
const R = "[redacted]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[depth]";
  if (typeof value === "string")
    return SECRET_VALUE_RES.reduce((acc, re) => acc.replace(re, R), value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redact(value.message, depth + 1),
      stack: redact(value.stack, depth + 1),
    };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SECRET_KEY_RE.test(k) ? R : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}
