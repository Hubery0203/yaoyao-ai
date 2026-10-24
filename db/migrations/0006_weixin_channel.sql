-- Personal Weixin channel. Credentials remain in a private server file.
CREATE TABLE weixin_channels (
 bot_id text PRIMARY KEY, peer_id text NOT NULL,
 user_id uuid REFERENCES users(user_id),
 cursor text NOT NULL DEFAULT '', cutoff_ms bigint NOT NULL,
 paused boolean NOT NULL DEFAULT false, auth_expired boolean NOT NULL DEFAULT false,
 credential_version text NOT NULL, last_error text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE weixin_binding_codes (
 code_hash text PRIMARY KEY, bot_id text NOT NULL REFERENCES weixin_channels(bot_id),
 user_id uuid NOT NULL REFERENCES users(user_id), expires_at timestamptz NOT NULL
);
CREATE TABLE weixin_messages (
 bot_id text NOT NULL REFERENCES weixin_channels(bot_id), message_key text NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 user_id uuid NOT NULL REFERENCES users(user_id), text text NOT NULL CHECK(length(text)<=4000),
 context_token text NOT NULL, reply text,
 stage text NOT NULL DEFAULT 'pending' CHECK(stage IN ('pending','generating','ready','sending','accepted','uncertain','failed','confirmed','skipped')),
 attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_error text, ack_level text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(bot_id,message_key)
);
CREATE INDEX weixin_pending ON weixin_messages(bot_id,ordinal) WHERE stage NOT IN ('accepted','confirmed','skipped');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['weixin_channels','weixin_binding_codes','weixin_messages'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format($p$CREATE POLICY channel ON %I USING (bot_id=NULLIF(current_setting('app.weixin_bot_id',true),'')) WITH CHECK (bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''))$p$,t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO yaoyao_app',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE weixin_messages_ordinal_seq TO yaoyao_app;
