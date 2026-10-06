# db/migrations/

Forward-only, checksummed, reviewed SQL migrations (Technical Proposal §05).

Discipline:
- One migration per change; never edit an applied migration.
- Destructive changes use expand → migrate → contract across releases.
- A migration MUST NOT rewrite Frozen Contract values or make historical
  events mutable.
- Drizzle config: `drizzle.config.ts` (schema placeholder until Phase 3).

Phase 1: no migrations yet. The first migration (initial schema) lands in
Phase 3 (Persistence).
