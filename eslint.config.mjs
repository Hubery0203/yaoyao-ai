// ESLint flat config — Phase 1: TypeScript recommended rules.
// Architecture boundaries are enforced by dependency-cruiser (see .dependency-cruiser.cjs
// and scripts/check-boundaries.mjs), not by ESLint.
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", ".src/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" },
      ],
    },
  },
);
