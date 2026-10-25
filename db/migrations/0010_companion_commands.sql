-- Independent confirmation namespace for preferences/recent-life; no identity or memory schema changes.
CREATE TABLE companion_actions (
 user_id uuid NOT NULL REFERENCES users(user_id),code text NOT NULL CHECK(code ~ '^[A-F0-9]{6}$'),
 kind text NOT NULL CHECK(kind IN ('preferences','life')),payload jsonb NOT NULL,
 expires_at timestamptz NOT NULL,status text NOT NULL CHECK(status IN ('pending','done','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(user_id,code),
 CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=16384)
);
ALTER TABLE companion_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner ON companion_actions USING(user_id=NULLIF(current_setting('app.user_id',true),'')::uuid) WITH CHECK(user_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
REVOKE ALL ON companion_actions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON companion_actions TO yaoyao_app;
