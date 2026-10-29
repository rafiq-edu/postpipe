import { describe, expect, it } from "vitest";
import {
  buildTrail,
  postTitle,
  searchFilter,
  shortId,
} from "../lib/posts/view";

describe("postTitle", () => {
  it("uses first non-empty line, trimmed", () => {
    expect(postTitle("\n  \n  Hello world  \nsecond")).toBe("Hello world");
  });
  it("cuts at 60 chars with ellipsis", () => {
    const t = postTitle("a".repeat(80));
    expect(t).toBe(`${"a".repeat(59)}…`);
    expect(t).toHaveLength(60);
  });
  it("keeps exactly 60 chars", () => {
    expect(postTitle("b".repeat(60))).toBe("b".repeat(60));
  });
  it("falls back for empty or null", () => {
    expect(postTitle("  \n ")).toBe("Untitled post");
    expect(postTitle(null)).toBe("Untitled post");
  });
});

describe("shortId", () => {
  it("prefixes first 4 chars", () => {
    expect(shortId("4f2a1b2c-0000-4000-8000-000000000000")).toBe("pst_4f2a");
  });
});

const post = { created_at: "2024-10-14T10:42:01Z" };
const target = {
  id: "t1",
  platform: "mock",
  status: "error",
  created_at: "2024-10-14T10:42:02Z",
  started_at: "2024-10-14T10:42:03Z",
  published_at: null,
  platform_post_url: null,
  error_code: "mock_delivery_failed",
  error_message: "Simulated failure.",
  attempts: 1,
};

describe("buildTrail", () => {
  it("builds received, queued, runs, failure", () => {
    const [g] = buildTrail(
      post,
      [target],
      [
        {
          target_id: "t1",
          step: "publish_media",
          status: "error",
          started_at: "2024-10-14T10:42:03Z",
          finished_at: "2024-10-14T10:42:04Z",
        },
      ],
    );
    expect(g.entries.map((e) => [e.label, e.kind])).toEqual([
      ["Received", "ok"],
      ["Queued", "ok"],
      ["Publish media", "error"],
      ["Mock delivery failed", "error"],
    ]);
    expect(g.entries[3].at).toBe("2024-10-14T10:42:04Z");
  });
  it("orders runs by started_at and ignores other targets", () => {
    const [g] = buildTrail(
      post,
      [{ ...target, status: "running" }],
      [
        {
          target_id: "t1",
          step: "b",
          status: "running",
          started_at: "2024-10-14T10:42:05Z",
          finished_at: null,
        },
        {
          target_id: "t1",
          step: "a",
          status: "success",
          started_at: "2024-10-14T10:42:03Z",
          finished_at: null,
        },
        {
          target_id: "t2",
          step: "x",
          status: "success",
          started_at: "2024-10-14T10:42:04Z",
          finished_at: null,
        },
      ],
    );
    expect(g.entries.map((e) => e.label)).toEqual([
      "Received",
      "Queued",
      "A",
      "B",
    ]);
    expect(g.entries[3].kind).toBe("running");
  });
  it("adds published link on success, one group per target", () => {
    const groups = buildTrail(
      post,
      [
        {
          ...target,
          status: "success",
          published_at: "2024-10-14T10:43:00Z",
          platform_post_url: "https://x.test/1",
        },
        { ...target, id: "t2", platform: "bluesky", status: "pending" },
      ],
      [],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].entries.at(-1)).toMatchObject({
      label: "Published on Mock",
      href: "https://x.test/1",
    });
    expect(groups[1].platform).toBe("Bluesky");
    expect(groups[1].entries.map((e) => e.label)).toEqual([
      "Received",
      "Queued",
    ]);
  });
});

describe("searchFilter", () => {
  it('keeps special chars inside quotes, escaping \\ and "', () => {
    expect(searchFilter('a,b)"c\\d')).toBe(
      'caption.ilike."%a,b)\\"c\\\\\\\\d%"',
    );
  });
  it("escapes like wildcards and strips *", () => {
    expect(searchFilter("50%_*x")).toBe('caption.ilike."%50\\\\%\\\\_x%"');
  });
  it("adds an id range for a hex pst_ prefix", () => {
    const f = searchFilter("pst_4f2a");
    expect(f).toContain("and(id.gte.4f2a0000-0000-0000-0000-000000000000");
    expect(f).toContain("id.lte.4f2affff-ffff-ffff-ffff-ffffffffffff)");
  });
  it("adds no id range for a non-hex prefix", () => {
    expect(searchFilter("pst_zzzz")).toBe('caption.ilike."%pst\\\\_zzzz%"');
  });
});
