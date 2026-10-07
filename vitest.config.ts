import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Explicit aliases guarantee every @yaoyao/* import resolves to source
    // in the test environment. Without this, test files can resolve to
    // dist/ while src/ files resolve to src/, breaking instanceof checks
    // across package boundaries (two copies of each error class).
    alias: {
      "@yaoyao/application": resolve(root, "core/application/src/index.ts"),
      "@yaoyao/domain": resolve(root, "core/domain/src/index.ts"),
      "@yaoyao/http": resolve(root, "core/api/src/index.ts"),
      "@yaoyao/infrastructure": resolve(root, "core/infrastructure/src/index.ts"),
      "@yaoyao/runtime": resolve(root, "core/runtime/src/index.ts"),
    },
  },
  test: {
    include: [
      "tests/**/*.spec.ts",
      "apps/*/test/**/*.spec.ts",
      "apps/*/test/**/*.e2e.spec.ts",
      "core/*/test/**/*.spec.ts",
    ],
    testTimeout: 30000,
    // Contract tests shell out to dependency-cruiser; run them serially.
    poolOptions: { threads: { singleThread: true } },
  },
});
