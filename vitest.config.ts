import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// pnpm does not hoist vite, so use Node's loader; workers inherit process.env
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local (CI): DB tests skip
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: process.env.INTEGRATION
      ? configDefaults.exclude
      : ["tests/integration/**", ...configDefaults.exclude],
  },
});
