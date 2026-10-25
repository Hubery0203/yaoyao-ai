-- One durable paid-attempt reservation per explicit inbound message. No image bytes in PostgreSQL.
CREATE TABLE weixin_photos (
 bot_id text NOT NULL, message_key text NOT NULL, user_id uuid NOT NULL REFERENCES users(user_id),
 state text NOT NULL CHECK(state IN ('reserved','generated','uploaded','failed')),
 artifact text CHECK(artifact ~ '^[a-f0-9]{64}$'), media jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(bot_id,message_key), FOREIGN KEY(bot_id,message_key) REFERENCES weixin_messages(bot_id,message_key),
 CHECK(media IS NULL OR jsonb_typeof(media)='object')
);
CREATE INDEX weixin_photos_budget ON weixin_photos(bot_id,created_at DESC);
ALTER TABLE weixin_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE weixin_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY channel ON weixin_photos USING(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),'')) WITH CHECK(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''));
REVOKE ALL ON weixin_photos FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON weixin_photos TO yaoyao_app;
