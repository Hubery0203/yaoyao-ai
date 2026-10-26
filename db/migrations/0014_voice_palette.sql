-- Extend the bounded stock voice palette without modifying settings, jobs, quotas or RLS.
-- Preserve the already-published 0013 checksum and the three original profile keys.
ALTER TABLE weixin_voice_settings DROP CONSTRAINT weixin_voice_settings_voice_check,
 ADD CONSTRAINT weixin_voice_settings_voice_check CHECK(voice IN ('coral','marin','shimmer','wumei','diadia'));
ALTER TABLE weixin_voices DROP CONSTRAINT weixin_voices_voice_check,
 ADD CONSTRAINT weixin_voices_voice_check CHECK(voice IN ('coral','marin','shimmer','wumei','diadia'));
