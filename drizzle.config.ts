import { defineConfig } from "drizzle-kit";

// Phase 3: schema definitions live under core/infrastructure/src/postgres/schema/.
// Shipped migrations are hand-reviewed SQL in db/migrations/ (forward-only,
// checksummed). `drizzle-kit generate` is used as a cross-check only — its
// output is never applied directly, because roles, RLS, grants, and the
// append-only trigger are hand-authored in the reviewed migration files.
export default defineConfig({
  dialect: "postgresql",
  schema: "./core/infrastructure/src/postgres/schema/index.ts",
  out: "./db/migrations",
  strict: true,
  verbose: true,
});
