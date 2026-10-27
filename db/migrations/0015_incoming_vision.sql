-- Incoming CDN references are private, bounded, and erased after interpretation/cancellation.
ALTER TABLE weixin_messages ADD COLUMN incoming_image jsonb
 CHECK(incoming_image IS NULL OR (jsonb_typeof(incoming_image)='object'
 AND incoming_image ? 'status' AND COALESCE(incoming_image->>'status' IN ('ready','unsupported','consumed'),false) AND octet_length(incoming_image::text)<=22000));
CREATE TABLE weixin_vision (
 bot_id text NOT NULL, message_key text NOT NULL, user_id uuid NOT NULL REFERENCES users(user_id),
 state text NOT NULL CHECK(state IN ('reserved','analyzed','failed')),
 response text CHECK(length(response)<=2000), failure_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(bot_id,message_key), FOREIGN KEY(bot_id,message_key) REFERENCES weixin_messages(bot_id,message_key),
 CHECK((state='reserved' AND response IS NULL) OR (state IN ('analyzed','failed') AND response IS NOT NULL))
);
CREATE INDEX weixin_vision_budget ON weixin_vision(bot_id,created_at DESC);
ALTER TABLE weixin_vision ENABLE ROW LEVEL SECURITY;
ALTER TABLE weixin_vision FORCE ROW LEVEL SECURITY;
CREATE POLICY channel ON weixin_vision USING(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''))
 WITH CHECK(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''));
REVOKE ALL ON weixin_vision FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON weixin_vision TO yaoyao_app;
