-- Migration 0003: add USER_MESSAGE / ASSISTANT_MESSAGE to events_type_allowed.
--
-- MVP-002G persists complete conversation turns as events (USER_MESSAGE at
-- Step 2, ASSISTANT_MESSAGE at Step 10). The domain EVENT_TYPES allowlist
-- was extended additively; this migration extends the DB CHECK constraint
-- to match. Purely additive: no existing type is removed or renamed.

ALTER TABLE "events" DROP CONSTRAINT "events_type_allowed";

ALTER TABLE "events" ADD CONSTRAINT "events_type_allowed" CHECK (
  "type" IN (
    'USER_CREATED',
    'YAOYAO_CREATED',
    'RELATIONSHIP_CREATED',
    'STATE_CREATED',
    'SESSION_STARTED',
    'SESSION_ENDED',
    'STATE_CHANGED',
    'MEMORY_CORRECTED',
    'USER_MESSAGE',
    'ASSISTANT_MESSAGE'
  )
);
