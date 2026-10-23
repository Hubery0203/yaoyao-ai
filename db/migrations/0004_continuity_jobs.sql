-- Reconstructed 003A. New migration; original lost 0004-0006 are unavailable.
CREATE TABLE continuity_jobs (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  yaoyao_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) > 0),
  assistant_event_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','completed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(user_id, yaoyao_id, request_id),
  UNIQUE(assistant_event_id),
  FOREIGN KEY (assistant_event_id,user_id,yaoyao_id) REFERENCES events(event_id,user_id,yaoyao_id) ON DELETE RESTRICT,
  CHECK ((status = 'claimed') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status = 'claimed' OR (lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX continuity_jobs_pending_idx ON continuity_jobs(user_id,created_at,job_id) WHERE status = 'pending';
CREATE INDEX continuity_jobs_expiry_idx ON continuity_jobs(user_id,lease_expires_at) WHERE status = 'claimed';
ALTER TABLE continuity_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE continuity_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY continuity_jobs_owner ON continuity_jobs
  USING (user_id = NULLIF(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id',true),'')::uuid);
REVOKE ALL ON continuity_jobs FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON continuity_jobs TO yaoyao_app;
GRANT SELECT ON continuity_jobs TO yaoyao_readonly;
