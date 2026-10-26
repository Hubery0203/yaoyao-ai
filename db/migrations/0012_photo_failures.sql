-- Only allowlisted diagnostic codes; never provider error bodies/prompts/credentials.
ALTER TABLE weixin_photos ADD COLUMN failure_code text
 CHECK(failure_code IS NULL OR failure_code IN ('PHOTO_CREDIT_EXHAUSTED','PHOTO_RATE_LIMITED','PHOTO_AUTH_FAILED','PHOTO_REJECTED','PHOTO_RESULT_UNKNOWN','PHOTO_PROVIDER_FAILED'));
