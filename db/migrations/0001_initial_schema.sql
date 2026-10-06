-- ============================================================================
-- 0001_initial_schema.sql — YaoYao AI MVP-001 Phase 3 · Persistence
--
-- REVIEWED MIGRATION (human-reviewed; drizzle-kit output was used as a
-- cross-check only and is NOT applied). Forward-only: never edit after
-- apply. Runs in a single transaction (see migration runner).
--
-- Contents:
--   1. Extensions (pgvector, citext)
--   2. Twelve tables (DDL mirrors core/infrastructure/src/postgres/schema/)
--   3. Append-only enforcement for events (revoke + trigger)
--   4. Least-privilege roles and grants
--   5. Row-level security (owner isolation, defense-in-depth)
--   6. schema_migrations history table
--
-- CHECK constraints mirror frozen domain invariants as defense-in-depth
-- ONLY. PostgreSQL is the persistence layer, not the business-rule
-- authority: the domain remains authoritative.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Extensions
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "citext";

-- --------------------------------------------------------------------------
-- 2. Tables
-- --------------------------------------------------------------------------

CREATE TABLE "users" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "email" "citext" NOT NULL,
  "password_hash" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email"),
  CONSTRAINT "users_password_hash_nonempty" CHECK (length("password_hash") > 0),
  CONSTRAINT "users_status_allowed" CHECK ("status" IN ('active','suspended')),
  CONSTRAINT "users_chronology" CHECK ("updated_at" >= "created_at")
);
CREATE INDEX "users_status_created_idx" ON "users" USING btree ("status","created_at");

CREATE TABLE "yaoyaos" (
  "yaoyao_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "identity_key" text NOT NULL,
  "identity_version" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "yaoyaos_user_id_unique" UNIQUE("user_id"),
  CONSTRAINT "yaoyaos_identity_key" CHECK ("identity_key" = 'shen_zhiyao'),
  CONSTRAINT "yaoyaos_identity_version_nonempty" CHECK (length("identity_version") > 0),
  CONSTRAINT "yaoyaos_status_active" CHECK ("status" = 'active'),
  CONSTRAINT "yaoyaos_chronology" CHECK ("updated_at" >= "created_at")
);
CREATE UNIQUE INDEX "yaoyaos_user_yaoyao_uidx" ON "yaoyaos" USING btree ("user_id","yaoyao_id");

CREATE TABLE "relationships" (
  "relationship_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "yaoyao_id" uuid NOT NULL,
  "type" text NOT NULL,
  "status" text NOT NULL,
  "termination_allowed" boolean NOT NULL,
  "intimacy" numeric(5, 4) NOT NULL,
  "trust" numeric(5, 4) NOT NULL,
  "familiarity" numeric(5, 4) NOT NULL,
  "affection" numeric(5, 4) NOT NULL,
  "hurt" numeric(5, 4) NOT NULL,
  "conflict" numeric(5, 4) NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "relationships_type" CHECK ("type" = 'deep_partner'),
  CONSTRAINT "relationships_status" CHECK ("status" = 'active'),
  CONSTRAINT "relationships_termination_forbidden" CHECK ("termination_allowed" = false),
  CONSTRAINT "relationships_intimacy_01" CHECK ("intimacy" >= 0 AND "intimacy" <= 1),
  CONSTRAINT "relationships_trust_01" CHECK ("trust" >= 0 AND "trust" <= 1),
  CONSTRAINT "relationships_familiarity_01" CHECK ("familiarity" >= 0 AND "familiarity" <= 1),
  CONSTRAINT "relationships_affection_01" CHECK ("affection" >= 0 AND "affection" <= 1),
  CONSTRAINT "relationships_hurt_01" CHECK ("hurt" >= 0 AND "hurt" <= 1),
  CONSTRAINT "relationships_conflict_01" CHECK ("conflict" >= 0 AND "conflict" <= 1),
  CONSTRAINT "relationships_chronology" CHECK ("updated_at" >= "created_at")
);
CREATE UNIQUE INDEX "relationships_owner_uidx" ON "relationships" USING btree ("user_id","yaoyao_id");

CREATE TABLE "core_states" (
  "state_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "yaoyao_id" uuid NOT NULL,
  "emotion" jsonb NOT NULL,
  "energy" numeric(5, 4) NOT NULL,
  "social_state" text NOT NULL,
  "relationship_state" text NOT NULL,
  "attention" text NOT NULL,
  "internal_state" jsonb NOT NULL,
  "state_version" bigint NOT NULL,
  "last_updated" timestamp with time zone NOT NULL,
  CONSTRAINT "core_states_emotion_object" CHECK (jsonb_typeof("emotion") = 'object'),
  CONSTRAINT "core_states_energy_01" CHECK ("energy" >= 0 AND "energy" <= 1),
  CONSTRAINT "core_states_relationship_state" CHECK ("relationship_state" IN ('calm','affectionate','hurt','conflicted','reconciled')),
  CONSTRAINT "core_states_internal_object" CHECK (jsonb_typeof("internal_state") = 'object'),
  CONSTRAINT "core_states_version_min" CHECK ("state_version" >= 1)
);
CREATE UNIQUE INDEX "core_states_yaoyao_uidx" ON "core_states" USING btree ("yaoyao_id");
CREATE UNIQUE INDEX "core_states_owner_uidx" ON "core_states" USING btree ("user_id","yaoyao_id");
CREATE INDEX "core_states_owner_version_idx" ON "core_states" USING btree ("user_id","yaoyao_id","state_version");

CREATE TABLE "memory_containers" (
  "container_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "yaoyao_id" uuid NOT NULL,
  "schema_version" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "memory_containers_schema_version_min" CHECK ("schema_version" >= 1)
);
CREATE UNIQUE INDEX "memory_containers_yaoyao_uidx" ON "memory_containers" USING btree ("yaoyao_id");
CREATE UNIQUE INDEX "memory_containers_owner_uidx" ON "memory_containers" USING btree ("container_id","user_id","yaoyao_id");

CREATE TABLE "memories" (
  "memory_id" uuid PRIMARY KEY NOT NULL,
  "container_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "yaoyao_id" uuid NOT NULL,
  "type" text NOT NULL,
  "content" text NOT NULL,
  "importance" numeric(5, 4) NOT NULL,
  "confidence" numeric(5, 4) NOT NULL,
  "source_events" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "status" text NOT NULL,
  "version" integer NOT NULL,
  "supersedes" uuid,
  "archive_reason" text,
  "last_recalled_at" timestamp with time zone,
  "times_recalled" bigint NOT NULL,
  "embedding" vector,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "memories_type_allowed" CHECK ("type" IN ('CORE','SEMANTIC','EPISODIC','SHARED_LIFE')),
  CONSTRAINT "memories_status_allowed" CHECK ("status" IN ('CANDIDATE','VALIDATED','CONSOLIDATED','CORRECTED','ARCHIVED')),
  CONSTRAINT "memories_content_nonempty" CHECK (length("content") > 0),
  CONSTRAINT "memories_importance_01" CHECK ("importance" >= 0 AND "importance" <= 1),
  CONSTRAINT "memories_confidence_01" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "memories_version_min" CHECK ("version" >= 1),
  CONSTRAINT "memories_times_recalled_min" CHECK ("times_recalled" >= 0),
  CONSTRAINT "memories_chronology" CHECK ("updated_at" >= "created_at")
);
CREATE UNIQUE INDEX "memories_supersedes_uidx" ON "memories" USING btree ("supersedes") WHERE "supersedes" IS NOT NULL;
CREATE INDEX "memories_owner_lookup_idx" ON "memories" USING btree ("user_id","type","status","updated_at" DESC);
CREATE INDEX "memories_source_events_gin" ON "memories" USING gin ("source_events");

CREATE TABLE "sessions" (
  "session_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "yaoyao_id" uuid NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "status" text NOT NULL,
  "client_instance_id" text,
  CONSTRAINT "sessions_ended_after_start" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
  CONSTRAINT "sessions_status_allowed" CHECK ("status" IN ('active','closed')),
  CONSTRAINT "sessions_status_coherence" CHECK (("status" = 'active' AND "ended_at" IS NULL) OR ("status" = 'closed' AND "ended_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "sessions_session_owner_uidx" ON "sessions" USING btree ("session_id","user_id","yaoyao_id");
CREATE INDEX "sessions_owner_status_idx" ON "sessions" USING btree ("user_id","status","started_at" DESC);
CREATE INDEX "sessions_owner_started_idx" ON "sessions" USING btree ("user_id","yaoyao_id","started_at" DESC);

CREATE TABLE "events" (
  "event_id" uuid PRIMARY KEY NOT NULL,
  "aggregate_seq" bigint NOT NULL,
  "type" text NOT NULL,
  "actor" text NOT NULL,
  "source" text NOT NULL,
  "user_id" uuid NOT NULL,
  "yaoyao_id" uuid NOT NULL,
  "session_id" uuid,
  "occurred_at" timestamp with time zone NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "payload" jsonb NOT NULL,
  "confidence" numeric(5, 4) NOT NULL,
  "causation_id" uuid,
  "correlation_id" text,
  "schema_version" integer NOT NULL,
  CONSTRAINT "events_seq_min" CHECK ("aggregate_seq" >= 1),
  CONSTRAINT "events_type_allowed" CHECK ("type" IN ('USER_CREATED','YAOYAO_CREATED','RELATIONSHIP_CREATED','STATE_CREATED','SESSION_STARTED','SESSION_ENDED','STATE_CHANGED','MEMORY_CORRECTED')),
  CONSTRAINT "events_actor_allowed" CHECK ("actor" IN ('USER','YAOYAO','SYSTEM')),
  CONSTRAINT "events_source_allowed" CHECK ("source" IN ('CLIENT','CORE','SYSTEM','MIGRATION')),
  CONSTRAINT "events_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "events_confidence_01" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "events_schema_version_min" CHECK ("schema_version" >= 1)
);
CREATE UNIQUE INDEX "events_yaoyao_seq_uidx" ON "events" USING btree ("yaoyao_id","aggregate_seq");
CREATE UNIQUE INDEX "events_event_owner_uidx" ON "events" USING btree ("event_id","user_id","yaoyao_id");
CREATE INDEX "events_replay_idx" ON "events" USING btree ("user_id","yaoyao_id","aggregate_seq");
CREATE INDEX "events_owner_recorded_idx" ON "events" USING btree ("user_id","recorded_at" DESC);
CREATE INDEX "events_session_seq_idx" ON "events" USING btree ("session_id","aggregate_seq") WHERE "session_id" IS NOT NULL;
CREATE INDEX "events_owner_type_idx" ON "events" USING btree ("user_id","type","recorded_at" DESC);

CREATE TABLE "refresh_sessions" (
  "refresh_session_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" bytea NOT NULL,
  "token_family_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "rotated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "device_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "refresh_sessions_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "refresh_sessions_rotated_after_create" CHECK ("rotated_at" IS NULL OR "rotated_at" >= "created_at"),
  CONSTRAINT "refresh_sessions_revoked_after_create" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);
CREATE INDEX "refresh_sessions_owner_family_idx" ON "refresh_sessions" USING btree ("user_id","token_family_id");
CREATE INDEX "refresh_sessions_active_expiry_idx" ON "refresh_sessions" USING btree ("expires_at") WHERE "revoked_at" IS NULL AND "rotated_at" IS NULL;

CREATE TABLE "idempotency_records" (
  "idempotency_record_id" uuid PRIMARY KEY NOT NULL,
  "user_scope" text NOT NULL,
  "key_hash" bytea NOT NULL,
  "operation" text NOT NULL,
  "request_hash" bytea NOT NULL,
  "status" text NOT NULL,
  "response_ref" jsonb,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "idempotency_records_status_allowed" CHECK ("status" IN ('processing','completed','failed')),
  CONSTRAINT "idempotency_records_expiry_after_create" CHECK ("expires_at" >= "created_at"),
  CONSTRAINT "idempotency_records_chronology" CHECK ("updated_at" >= "created_at")
);
CREATE UNIQUE INDEX "idempotency_records_key_uidx" ON "idempotency_records" USING btree ("user_scope","operation","key_hash");
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");

CREATE TABLE "outbox" (
  "outbox_id" uuid PRIMARY KEY NOT NULL,
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "yaoyao_id" uuid NOT NULL,
  "topic" text NOT NULL,
  "payload_ref" jsonb NOT NULL,
  "available_at" timestamp with time zone NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "published_at" timestamp with time zone,
  "locked_at" timestamp with time zone,
  "locked_by" text,
  "last_error" text,
  CONSTRAINT "outbox_topic_nonempty" CHECK (length("topic") > 0),
  CONSTRAINT "outbox_payload_ref_object" CHECK (jsonb_typeof("payload_ref") = 'object'),
  CONSTRAINT "outbox_attempts_min" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "outbox_event_topic_uidx" ON "outbox" USING btree ("event_id","topic");
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at") WHERE "published_at" IS NULL;

CREATE TABLE "schema_migrations" (
  "version" text PRIMARY KEY NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" timestamp with time zone NOT NULL,
  "applied_by" text NOT NULL,
  "execution_ms" bigint NOT NULL,
  CONSTRAINT "schema_migrations_checksum_sha256" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "schema_migrations_execution_ms_min" CHECK ("execution_ms" >= 0)
);

-- --------------------------------------------------------------------------
-- Foreign keys (composite ownership: a child can only attach to a YaoYao
-- owned by the same user)
-- --------------------------------------------------------------------------
ALTER TABLE "yaoyaos" ADD CONSTRAINT "yaoyaos_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE restrict;
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_owner_fk"
  FOREIGN KEY ("user_id","yaoyao_id") REFERENCES "yaoyaos"("user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "core_states" ADD CONSTRAINT "core_states_owner_fk"
  FOREIGN KEY ("user_id","yaoyao_id") REFERENCES "yaoyaos"("user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "memory_containers" ADD CONSTRAINT "memory_containers_owner_fk"
  FOREIGN KEY ("user_id","yaoyao_id") REFERENCES "yaoyaos"("user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "memories" ADD CONSTRAINT "memories_container_fk"
  FOREIGN KEY ("container_id","user_id","yaoyao_id") REFERENCES "memory_containers"("container_id","user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "memories" ADD CONSTRAINT "memories_owner_fk"
  FOREIGN KEY ("user_id","yaoyao_id") REFERENCES "yaoyaos"("user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "memories" ADD CONSTRAINT "memories_supersedes_fk"
  FOREIGN KEY ("supersedes") REFERENCES "memories"("memory_id") ON DELETE restrict;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_fk"
  FOREIGN KEY ("user_id","yaoyao_id") REFERENCES "yaoyaos"("user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "events" ADD CONSTRAINT "events_owner_fk"
  FOREIGN KEY ("user_id","yaoyao_id") REFERENCES "yaoyaos"("user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "events" ADD CONSTRAINT "events_session_fk"
  FOREIGN KEY ("session_id","user_id","yaoyao_id") REFERENCES "sessions"("session_id","user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "events" ADD CONSTRAINT "events_causation_fk"
  FOREIGN KEY ("causation_id") REFERENCES "events"("event_id") ON DELETE restrict;
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE restrict;
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_fk"
  FOREIGN KEY ("event_id","user_id","yaoyao_id") REFERENCES "events"("event_id","user_id","yaoyao_id") ON DELETE restrict;
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_owner_fk"
  FOREIGN KEY ("user_id","yaoyao_id") REFERENCES "yaoyaos"("user_id","yaoyao_id") ON DELETE restrict;

-- --------------------------------------------------------------------------
-- 3. Append-only enforcement for events (defense layer 2: role grants are
--    layer 1, this trigger is layer 2; the application port exposes no
--    update/delete at all)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_immutable ON events;
CREATE TRIGGER events_immutable
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();

-- --------------------------------------------------------------------------
-- 4. Least-privilege roles (created NOLOGIN here; operators enable login
--    and set passwords out-of-band — no secrets in migration SQL)
-- --------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yaoyao_migrate') THEN
    CREATE ROLE yaoyao_migrate WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yaoyao_app') THEN
    CREATE ROLE yaoyao_app WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yaoyao_readonly') THEN
    CREATE ROLE yaoyao_readonly WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yaoyao_breakglass') THEN
    CREATE ROLE yaoyao_breakglass WITH NOLOGIN;
  END IF;
END $$;

-- Harden the public schema: no implicit CREATE for everyone.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO yaoyao_app, yaoyao_readonly;

-- yaoyao_app: scoped DML for repository use cases. Events are SELECT+INSERT
-- only; UPDATE/DELETE are revoked (belt) and rejected by trigger (suspenders).
GRANT SELECT, INSERT, UPDATE ON
  users, yaoyaos, relationships, core_states, memory_containers,
  memories, sessions, refresh_sessions, idempotency_records
  TO yaoyao_app;
GRANT SELECT, INSERT ON events TO yaoyao_app;
REVOKE UPDATE, DELETE ON events FROM yaoyao_app;
GRANT SELECT, INSERT ON outbox TO yaoyao_app;

-- yaoyao_readonly: diagnostics without secret material. users (password
-- hashes), refresh_sessions (token hashes), and idempotency_records are
-- excluded; schema_migrations is never granted to runtime roles.
GRANT SELECT ON
  yaoyaos, relationships, core_states, memory_containers,
  memories, sessions, events, outbox
  TO yaoyao_readonly;

-- yaoyao_breakglass: emergency only — disabled by default, never granted
-- here. Access requires an approved runbook, ticketed reason, time-bound
-- credentials, and full audit logging.

-- --------------------------------------------------------------------------
-- 5. Row-level security — owner isolation as defense-in-depth.
--    The application role is NOBYPASSRLS by default (non-superuser) and is
--    not the table owner; every transaction sets app.user_id transaction-
--    locally (SET LOCAL), so pooled-connection reuse cannot leak context.
-- --------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','yaoyaos','relationships','core_states','memory_containers',
    'memories','sessions','events','refresh_sessions','outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner', t);
    -- Owner predicate: NULLIF hardens the policy against an empty (but set)
    -- app.user_id — an empty context must fail closed (see no rows), not
    -- raise 22P02 on the ::uuid cast. A missing context already yields NULL
    -- via missing_ok=true and behaves the same way.
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid) WITH CHECK (user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid)',
      t || '_owner', t
    );
  END LOOP;
END $$;
