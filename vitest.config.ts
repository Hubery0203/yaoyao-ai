import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
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
