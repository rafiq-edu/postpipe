import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildOpenApi } from "@/lib/api/openapi";
import pkg from "../package.json" with { type: "json" };

it("builds a valid OpenAPI 3.1 document", () => {
  const doc = buildOpenApi() as {
    openapi: string;
    info: { version: string };
    paths: Record<string, { post: { operationId: string } }>;
  };
  expect(doc.openapi).toBe("3.1.0");
  expect(doc.info.version).toBe(pkg.version);
  expect(doc.paths["/social-posts"].post.operationId).toBe("createSocialPost");

  const file = join(mkdtempSync(join(tmpdir(), "openapi-")), "openapi.json");
  writeFileSync(file, JSON.stringify(doc));
  // Redocly exits non-zero on errors; execFileSync throws.
  execFileSync("pnpm", ["exec", "redocly", "lint", file, "--format=stylish"], {
    encoding: "utf8",
    stdio: "pipe",
  });
}, 60_000);
