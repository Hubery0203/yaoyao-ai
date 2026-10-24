-- Additive channel state; existing Core facts/events remain untouched.
ALTER TABLE weixin_channels
 ADD COLUMN outreach_settings jsonb NOT NULL DEFAULT '{"enabled":false,"timezone":"Asia/Tokyo","quietStart":1320,"quietEnd":480,"dailyLimit":1,"greeting":false,"greetingMinute":540}'::jsonb,
 ADD COLUMN outreach_version integer NOT NULL DEFAULT 0,
 ADD COLUMN outreach_since timestamptz,
 ADD COLUMN last_inbound_at timestamptz,
 ADD COLUMN last_context_token text,
 ADD CONSTRAINT outreach_settings_object CHECK(jsonb_typeof(outreach_settings)='object');
ALTER TABLE weixin_messages
 ADD COLUMN batch_key text,
 ADD COLUMN turn_text text CHECK(length(turn_text)<=4000),
 ADD COLUMN origin text NOT NULL DEFAULT 'reactive' CHECK(origin IN ('reactive','proactive')),
 ADD COLUMN outreach_version integer,
 ADD COLUMN outreach_day text,
 ADD COLUMN outreach_reason text,
 ADD COLUMN history_recorded boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT weixin_batch_parent FOREIGN KEY(bot_id,batch_key) REFERENCES weixin_messages(bot_id,message_key);
CREATE INDEX weixin_leaders ON weixin_messages(bot_id,ordinal) WHERE batch_key IS NULL AND stage NOT IN ('accepted','confirmed','skipped');
CREATE TABLE weixin_followups (
 id uuid PRIMARY KEY, bot_id text NOT NULL REFERENCES weixin_channels(bot_id),
 user_id uuid NOT NULL REFERENCES users(user_id), message text NOT NULL CHECK(length(message) BETWEEN 1 AND 120),
 due_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 stage text NOT NULL DEFAULT 'pending' CHECK(stage IN ('pending','queued','cancelled','expired')),
 message_key text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(bot_id,message_key) REFERENCES weixin_messages(bot_id,message_key),
 CHECK(expires_at>due_at)
);
CREATE INDEX weixin_followups_due ON weixin_followups(bot_id,due_at) WHERE stage='pending';
ALTER TABLE weixin_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE weixin_followups FORCE ROW LEVEL SECURITY;
CREATE POLICY channel ON weixin_followups USING(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),'')) WITH CHECK(bot_id=NULLIF(current_setting('app.weixin_bot_id',true),''));
REVOKE ALL ON weixin_followups FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON weixin_followups TO yaoyao_app;
