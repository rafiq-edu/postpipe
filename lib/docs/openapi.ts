import { createOpenAPI } from "fumadocs-openapi/server";
import { buildOpenApi } from "@/lib/api/openapi";

// Read from the function at build time, not over HTTP.
export const openapi = createOpenAPI({
  input: { postpipe: () => buildOpenApi() as never }, // builder returns a plain object; the lib wants its own Document type
});
