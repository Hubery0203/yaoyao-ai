ALTER TABLE weixin_messages ADD COLUMN incoming_audio jsonb
 CHECK(incoming_audio IS NULL OR (jsonb_typeof(incoming_audio)='object'
 AND COALESCE(incoming_audio->>'status' IN ('ready','native','unsupported','consumed'),false) AND octet_length(incoming_audio::text)<=24000));
ALTER TABLE weixin_messages ADD CONSTRAINT one_incoming_media_kind CHECK(incoming_audio IS NULL OR incoming_image IS NULL);
CREATE TABLE weixin_audio (
 bot_id text NOT NULL, message_key text NOT NULL, user_id uuid NOT NULL REFERENCES users(user_id),
 state text NOT NULL CHECK(state IN ('reserved','transcribed','failed')),
 source text NOT NULL CHECK(source IN ('weixin','minimax')),
 transcript text CHECK(length(transcript)<=2000), failure_code text,
 attempted_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(bot_id,message_key), FOREIGN KEY(bot_id,message_key) REFERENCES weixin_messages(bot_id,message_key),
 CHECK((state='transcribed' AND transcript IS NOT NULL AND length(transcript)>0) OR (state IN ('reserved','failed') AND transcript IS NULL)),
 CHECK((source='minimax' AND attempted_at IS NOT NULL) OR (source='weixin' AND attempted_at IS NULL))
);
CREATE INDEX weixin_audio_budget ON weixin_audio(bot_id,attempted_at DESC) WHERE attempted_at IS NOT NULL;
ALTER TABLE weixin_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE weixin_audio FORCE ROW LEVEL SECURITY;
CREATE POLICY channel ON weixin_audio USING(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),'')) WITH CHECK(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''));
REVOKE ALL ON weixin_audio FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON weixin_audio TO yaoyao_app;
