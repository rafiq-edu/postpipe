import { PLATFORM_LABELS } from "@/lib/platforms/labels";
import type { Platform } from "@/lib/platforms/types";

export const postTitle = (caption: string | null): string => {
  const line = caption
    ?.split("\n")
    .find((l) => l.trim())
    ?.trim();
  if (!line) return "Untitled post";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

export const shortId = (id: string): string => `pst_${id.slice(0, 4)}`;

export const platformLabel = (p: string): string =>
  PLATFORM_LABELS[p as Platform] ?? p;

export type TrailTarget = {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  published_at: string | null;
  platform_post_url: string | null;
};
export type TrailRun = {
  target_id: string;
  step: string;
  status: string;
  started_at: string;
  finished_at: string | null;
};
export type TrailEntry = {
  label: string;
  at: string;
  kind: "ok" | "error" | "running";
  href?: string;
};
export type TrailGroup = {
  targetId: string;
  platform: string;
  entries: TrailEntry[];
};

const sentence = (s: string) => {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const buildTrail = (
  post: { created_at: string },
  targets: TrailTarget[],
  runs: TrailRun[],
): TrailGroup[] =>
  targets.map((t) => {
    const platform = platformLabel(t.platform);
    const mine = runs
      .filter((r) => r.target_id === t.id)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    const entries: TrailEntry[] = [
      { label: "Received", at: post.created_at, kind: "ok" },
      { label: "Queued", at: t.created_at, kind: "ok" },
      ...mine.map(
        (r): TrailEntry => ({
          label: sentence(r.step),
          at: r.started_at,
          kind:
            r.status === "success"
              ? "ok"
              : r.status === "error"
                ? "error"
                : "running",
        }),
      ),
    ];
    const last = mine.at(-1);
    if (t.status === "success") {
      entries.push({
        label: `Published on ${platform}`,
        at:
          t.published_at ??
          last?.finished_at ??
          last?.started_at ??
          t.created_at,
        kind: "ok",
        ...(t.platform_post_url ? { href: t.platform_post_url } : {}),
      });
    } else if (t.status === "error") {
      entries.push({
        label: `${platform} delivery failed`,
        at: last?.finished_at ?? last?.started_at ?? t.created_at,
        kind: "error",
      });
    }
    return { targetId: t.id, platform, entries };
  });

const UUID_FULL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Caption match, or id prefix (range over the uuid space). Values are quoted for PostgREST.
export function searchFilter(rawTerm: string) {
  const term = rawTerm.replace(/\*/g, ""); // * is a wildcard in PostgREST ilike
  const like = term.replace(/[\\%_]/g, "\\$&");
  const quoted = `"%${like.replace(/[\\"]/g, "\\$&")}%"`;
  const parts = [`caption.ilike.${quoted}`];
  const p = term.replace(/^pst_/i, "").toLowerCase();
  if (/^[0-9a-f-]{1,36}$/.test(p)) {
    const lo = p + "00000000-0000-0000-0000-000000000000".slice(p.length);
    const hi = p + "ffffffff-ffff-ffff-ffff-ffffffffffff".slice(p.length);
    if (UUID_FULL.test(lo) && UUID_FULL.test(hi))
      parts.push(`and(id.gte.${lo},id.lte.${hi})`);
  }
  return parts.join(",");
}
