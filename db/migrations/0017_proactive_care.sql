-- Explicit confirmed one-shot care topics reuse the durable outreach queue.
ALTER TABLE weixin_followups
 ADD COLUMN kind text NOT NULL DEFAULT 'reminder' CHECK(kind IN ('reminder','care')),
 ADD COLUMN care_topic text,
 ADD CONSTRAINT followup_care_topic CHECK(
  (kind='reminder' AND care_topic IS NULL) OR
  (kind='care' AND care_topic IS NOT NULL AND length(care_topic) BETWEEN 1 AND 40));
CREATE INDEX weixin_care_active ON weixin_followups(bot_id,care_topic)
 WHERE kind='care' AND stage IN ('pending','queued');
