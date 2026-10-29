// Writes the OpenAPI document for Fern. Output is generated and git-ignored.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildOpenApi } from "../lib/api/openapi";

mkdirSync("fern/openapi", { recursive: true });
writeFileSync(
  "fern/openapi/openapi.json",
  `${JSON.stringify(buildOpenApi(), null, 2)}\n`,
);
