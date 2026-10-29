import { expect, test } from "vitest";
import { problem, problemFromError } from "../lib/api/errors";

test("problem builds RFC 9457 body", async () => {
  const res = problem(401, "missing_api_key", "x");
  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  const b = await res.json();
  expect(b).toMatchObject({
    type: "https://postpipe.com/errors/missing_api_key",
    title: "Missing api key",
    status: 401,
    detail: "x",
    code: "missing_api_key",
  });
});

test("problemFromError hides internal messages", async () => {
  const res = problemFromError(new Error("boom"));
  expect(res.status).toBe(500);
  const b = await res.json();
  expect(b.code).toBeUndefined();
  expect(b.detail).not.toContain("boom");
});
