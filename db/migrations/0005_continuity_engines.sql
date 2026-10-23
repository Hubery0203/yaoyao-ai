-- Recovery v1 complete MVP-003 engines, audit and bounded retry policy.
ALTER TABLE continuity_jobs ADD COLUMN available_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE continuity_jobs ADD COLUMN last_error text;
ALTER TABLE continuity_jobs DROP CONSTRAINT continuity_jobs_status_check;
ALTER TABLE continuity_jobs ADD CONSTRAINT continuity_jobs_status_check CHECK(status IN ('pending','claimed','completed','failed'));
CREATE UNIQUE INDEX memories_id_owner_unique ON memories(memory_id,user_id,yaoyao_id);
CREATE UNIQUE INDEX continuity_jobs_id_owner_unique ON continuity_jobs(job_id,user_id,yaoyao_id);
ALTER TABLE events DROP CONSTRAINT events_type_allowed;
ALTER TABLE events ADD CONSTRAINT events_type_allowed CHECK (type IN (
'USER_CREATED','YAOYAO_CREATED','RELATIONSHIP_CREATED','STATE_CREATED','SESSION_STARTED','SESSION_ENDED',
'STATE_CHANGED','MEMORY_CORRECTED','USER_MESSAGE','ASSISTANT_MESSAGE','MEMORY_CONSOLIDATED'));
CREATE TABLE continuity_runs (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL, yaoyao_id uuid NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(job_id,user_id,yaoyao_id) REFERENCES continuity_jobs(job_id,user_id,yaoyao_id) ON DELETE RESTRICT
);
CREATE TABLE memory_candidate_audits (
  job_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal>=0), user_id uuid NOT NULL, yaoyao_id uuid NOT NULL,
  audit jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(job_id,ordinal),
  FOREIGN KEY(job_id,user_id,yaoyao_id) REFERENCES continuity_jobs(job_id,user_id,yaoyao_id) ON DELETE RESTRICT
);
CREATE TABLE memory_slots (
  user_id uuid NOT NULL, yaoyao_id uuid NOT NULL, slot text NOT NULL, value text NOT NULL,
  memory_id uuid NOT NULL, source_sequence bigint NOT NULL,
  PRIMARY KEY(user_id,yaoyao_id,slot),
  FOREIGN KEY(memory_id,user_id,yaoyao_id) REFERENCES memories(memory_id,user_id,yaoyao_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX memory_candidate_audits_owner_unique ON memory_candidate_audits(job_id,ordinal,user_id,yaoyao_id);
CREATE TABLE memory_candidate_resolutions (
  job_id uuid NOT NULL, ordinal integer NOT NULL, user_id uuid NOT NULL, yaoyao_id uuid NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(job_id,ordinal),
  FOREIGN KEY(job_id,ordinal,user_id,yaoyao_id) REFERENCES memory_candidate_audits(job_id,ordinal,user_id,yaoyao_id) ON DELETE RESTRICT
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['continuity_runs','memory_candidate_audits','memory_slots','memory_candidate_resolutions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($policy$CREATE POLICY owner ON %I USING (user_id=NULLIF(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id=NULLIF(current_setting('app.user_id',true),'')::uuid)$policy$,t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO yaoyao_app',t);
    EXECUTE format('GRANT SELECT ON %I TO yaoyao_readonly',t);
  END LOOP;
END $$;
GRANT UPDATE ON memory_slots TO yaoyao_app;
-- Candidate audits and completed runs are immutable even to runtime credentials.
CREATE FUNCTION reject_continuity_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'continuity audit is append-only'; END $$;
CREATE TRIGGER continuity_runs_immutable BEFORE UPDATE OR DELETE ON continuity_runs FOR EACH ROW EXECUTE FUNCTION reject_continuity_audit_mutation();
CREATE TRIGGER candidate_audits_immutable BEFORE UPDATE OR DELETE ON memory_candidate_audits FOR EACH ROW EXECUTE FUNCTION reject_continuity_audit_mutation();
CREATE TRIGGER candidate_resolutions_immutable BEFORE UPDATE OR DELETE ON memory_candidate_resolutions FOR EACH ROW EXECUTE FUNCTION reject_continuity_audit_mutation();
