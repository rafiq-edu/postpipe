// Lets `node worker.ts` load lib/: adds the .ts extension to relative imports and resolves the @/ alias.
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

/** @param {URL} url */
function withTs(url) {
  const file = fileURLToPath(url);
  for (const candidate of [`${file}.ts`, `${file}/index.ts`])
    if (fs.existsSync(candidate)) return new URL(`file://${candidate}`);
  return null;
}

registerHooks({
  /** @type {import("node:module").ResolveHook} */
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (!parent?.startsWith("file:") || parent.includes("/node_modules/"))
      return nextResolve(specifier, context);
    let url = null;
    if (specifier.startsWith("@/")) url = new URL(specifier.slice(2), root);
    else if (specifier.startsWith("./") || specifier.startsWith("../"))
      url = new URL(specifier, parent);
    if (url && !/\.[a-z]+$/i.test(url.pathname)) {
      const hit = withTs(url);
      if (hit) return { url: hit.href, shortCircuit: true };
    }
    if (url && specifier.startsWith("@/"))
      return nextResolve(url.href, context);
    return nextResolve(specifier, context);
  },
});
