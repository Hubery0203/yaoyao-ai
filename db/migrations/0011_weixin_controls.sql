-- Atomic channel-owner control replies and independently namespaced previews.
CREATE TABLE weixin_controls (
 bot_id text NOT NULL,message_key text NOT NULL,user_id uuid NOT NULL REFERENCES users(user_id),
 text text NOT NULL,reply text NOT NULL,code text CHECK(code ~ '^[A-F0-9]{8}$'),
 payload jsonb CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=16384),
 expected_version integer,expires_at timestamptz,status text NOT NULL CHECK(status IN ('receipt','pending','done','cancelled')),
 PRIMARY KEY(bot_id,message_key),UNIQUE(bot_id,code),
 FOREIGN KEY(bot_id,message_key) REFERENCES weixin_messages(bot_id,message_key),
 CHECK((status='receipt') OR (code IS NOT NULL AND payload IS NOT NULL AND expected_version IS NOT NULL AND expires_at IS NOT NULL))
);
ALTER TABLE weixin_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE weixin_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY channel ON weixin_controls USING(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),'')) WITH CHECK(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''));
REVOKE ALL ON weixin_controls FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON weixin_controls TO yaoyao_app;
