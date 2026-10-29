-- Runs once on first container init, as POSTGRES_USER (the application owner role).
-- Tables themselves are created by Alembic migrations.

-- Biometric data lives in its own schema. Nobody but the owner gets access by default.
CREATE SCHEMA IF NOT EXISTS biometric AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA biometric FROM PUBLIC;

-- Read-only reporting role (for BI / exports / support staff).
-- It may read public attendance tables but has NO access to the biometric schema.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_reporting') THEN
    CREATE ROLE attendance_reporting NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO attendance_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO attendance_reporting;
