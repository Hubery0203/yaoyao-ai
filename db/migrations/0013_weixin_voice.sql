-- Optional AI speech output. No audio bytes, secrets or extra Core facts.
-- NULL on old rows prevents retroactive synthesis; new rows retain the source timestamp.
ALTER TABLE weixin_messages ADD COLUMN source_created_ms bigint CHECK(source_created_ms>0);
CREATE TABLE weixin_voice_settings (
 bot_id text PRIMARY KEY REFERENCES weixin_channels(bot_id), user_id uuid NOT NULL REFERENCES users(user_id),
 enabled boolean NOT NULL DEFAULT false, voice text NOT NULL DEFAULT 'coral' CHECK(voice IN ('coral','marin','shimmer')),
 enabled_at timestamptz, version bigint NOT NULL DEFAULT 0,
 pending_hash text CHECK(pending_hash ~ '^[a-f0-9]{64}$'), pending_until timestamptz,
 CHECK(NOT enabled OR enabled_at IS NOT NULL)
);
CREATE TABLE weixin_voices (
 bot_id text NOT NULL, message_key text NOT NULL, user_id uuid NOT NULL REFERENCES users(user_id),
 reply_hash text NOT NULL CHECK(reply_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('eligible','reserved','generated','uploaded','failed')),
 voice text NOT NULL CHECK(voice IN ('coral','marin','shimmer')), settings_version bigint NOT NULL,
 delivery_kind text CHECK(delivery_kind IN ('audio','text')),
 artifact text CHECK(artifact ~ '^[a-f0-9]{64}$'), media jsonb CHECK(media IS NULL OR jsonb_typeof(media)='object'),
 failure_code text CHECK(failure_code IN ('VOICE_CREDIT_EXHAUSTED','VOICE_RATE_LIMITED','VOICE_AUTH_FAILED','VOICE_RESULT_UNKNOWN','VOICE_PROVIDER_FAILED','VOICE_ARTIFACT_MISSING')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), attempted_at timestamptz,
 PRIMARY KEY(bot_id,message_key), FOREIGN KEY(bot_id,message_key) REFERENCES weixin_messages(bot_id,message_key),
 CHECK((state='eligible' AND attempted_at IS NULL) OR (state<>'eligible' AND attempted_at IS NOT NULL))
);
CREATE INDEX weixin_voices_budget ON weixin_voices(bot_id,attempted_at DESC);
ALTER TABLE weixin_voice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE weixin_voice_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE weixin_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE weixin_voices FORCE ROW LEVEL SECURITY;
CREATE POLICY channel ON weixin_voice_settings USING(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),'')) WITH CHECK(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''));
CREATE POLICY channel ON weixin_voices USING(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),'')) WITH CHECK(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''));
REVOKE ALL ON weixin_voice_settings,weixin_voices FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON weixin_voice_settings,weixin_voices TO yaoyao_app;
