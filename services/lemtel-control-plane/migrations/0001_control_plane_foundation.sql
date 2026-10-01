-- Lemtel Control Plane foundation (dedicated self-hosted database only).
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control_plane_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action ~ '^control_plane\.[a-z0-9_.]{1,64}$'),
  request_id text CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  source text NOT NULL DEFAULT 'internal_test' CHECK (source = 'internal_test'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX control_plane_audit_events_request_id_key
  ON control_plane_audit_events (request_id) WHERE request_id IS NOT NULL;

REVOKE ALL ON control_plane_audit_events FROM PUBLIC;
REVOKE ALL ON schema_migrations FROM PUBLIC;
