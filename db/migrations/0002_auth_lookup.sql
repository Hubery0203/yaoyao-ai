-- 0002_auth_lookup.sql — narrowly-scoped credential lookups for the auth flow.
--
-- Problem: users and refresh_sessions are protected by FORCE ROW LEVEL
-- SECURITY owner policies (migration 0001). The login and token-refresh
-- flows must resolve (email -> user_id, password_hash) and
-- (token_hash -> refresh session) BEFORE any owner context exists, so
-- the RLS predicate cannot be satisfied. The application role is
-- NOBYPASSRLS and must stay that way.
--
-- Solution: two SECURITY DEFINER functions with the smallest possible
-- surface:
--   auth_find_user_by_email(p_email)      -> exactly one credential row
--   auth_find_refresh_session(p_token_hash) -> exactly one refresh session
-- Both run as the migration executor, which MUST be a superuser (asserted
-- below); superusers bypass even FORCE RLS. EXECUTE is granted only to
-- yaoyao_app and revoked from PUBLIC. The functions return the minimum
-- columns the auth flow needs — never a table-wide read.
--
-- The login endpoint is rate-limited (5/min/IP) to mitigate enumeration
-- via the email lookup; the use case additionally verifies against a
-- dummy hash when no row is found to avoid a fast-path oracle.

-- ---------------------------------------------------------------------------
-- Executor must be a superuser: the DEFINER must bypass FORCE RLS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION
      'migration 0002 requires a superuser executor: SECURITY DEFINER auth functions must bypass FORCE ROW LEVEL SECURITY';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- auth_find_user_by_email
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email citext)
RETURNS TABLE (
  user_id uuid,
  password_hash text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.user_id, u.password_hash, u.status
  FROM users AS u
  WHERE u.email = p_email
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_find_user_by_email(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(citext) TO yaoyao_app;

-- ---------------------------------------------------------------------------
-- auth_find_refresh_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_find_refresh_session(p_token_hash bytea)
RETURNS TABLE (
  refresh_session_id uuid,
  user_id uuid,
  token_hash bytea,
  token_family_id uuid,
  expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  device_metadata jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.refresh_session_id,
    s.user_id,
    s.token_hash,
    s.token_family_id,
    s.expires_at,
    s.rotated_at,
    s.revoked_at,
    s.device_metadata,
    s.created_at
  FROM refresh_sessions AS s
  WHERE s.token_hash = p_token_hash
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_find_refresh_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_refresh_session(bytea) TO yaoyao_app;
