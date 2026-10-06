import { defineConfig } from "drizzle-kit";

// Phase 1: placeholder. Schema definitions and the first migration land in Phase 3 (Persistence).
// Migrations are forward-only, checksummed, reviewed SQL in db/migrations/.
export default defineConfig({
  dialect: "postgresql",
  schema: "./core/infrastructure/src/postgres/schema.ts",
  out: "./db/migrations",
  strict: true,
  verbose: true,
});
