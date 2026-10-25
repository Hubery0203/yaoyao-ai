-- Per-owner preferences and recent-life metadata, separate from Core identity and durable memory.
CREATE TABLE companion_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(user_id), settings jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), muted_slots jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(jsonb_typeof(settings)='object'), CHECK(jsonb_typeof(muted_slots)='object')
);
CREATE TABLE life_events (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(user_id),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 50),
 state text NOT NULL CHECK(state IN ('planned','ongoing','completed','cancelled')),
 scheduled_day text, declared_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 source_sequence bigint NOT NULL CHECK(source_sequence>0), version integer NOT NULL CHECK(version>0),
 CHECK(expires_at>declared_at)
);
CREATE INDEX life_events_owner ON life_events(user_id,declared_at DESC,id);
CREATE UNIQUE INDEX memories_owner_id_008 ON memories(user_id,memory_id);
CREATE TABLE memory_actions (
 user_id uuid NOT NULL REFERENCES users(user_id), code text NOT NULL CHECK(code~'^[A-F0-9]{6}$'),
 kind text NOT NULL CHECK(kind IN ('remember','correct','disable')), memory_id uuid,
 expected_version integer, statement text, expires_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','done','cancelled')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,code), FOREIGN KEY(user_id,memory_id) REFERENCES memories(user_id,memory_id)
);
CREATE TABLE memory_command_replies (
 user_id uuid NOT NULL REFERENCES users(user_id), request_key text NOT NULL CHECK(length(request_key)<=80),
 input_text text NOT NULL CHECK(length(input_text)<=4000), reply text NOT NULL CHECK(length(reply)<=4000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,request_key)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['companion_preferences','life_events','memory_actions','memory_command_replies'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format($p$CREATE POLICY owner ON %I USING(user_id=NULLIF(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)$p$,t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO yaoyao_app',t);
 END LOOP;
END $$;

-- A literal migration-time epoch; runtime does not gain schema_migrations privileges.
DO $$ BEGIN
 EXECUTE format('CREATE FUNCTION public.companion_experience_activation() RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog AS %L',
   format('SELECT %L::timestamptz',clock_timestamp()));
END $$;
REVOKE ALL ON FUNCTION public.companion_experience_activation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.companion_experience_activation() TO yaoyao_app;
