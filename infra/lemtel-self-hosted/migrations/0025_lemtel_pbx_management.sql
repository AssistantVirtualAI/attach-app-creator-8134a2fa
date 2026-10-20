-- Lemtel phase 8 — FusionPBX management binding and operation audit (idempotent; applies twice).
-- One organization = one FusionPBX domain (domain_uuid). The REST API key stays in lemtel_pbx_connection_secrets,
-- encrypted; the optional web password (recording downloads) is a new write-only secret kind.
BEGIN;

ALTER TABLE public.lemtel_pbx_connections
  ADD COLUMN IF NOT EXISTS management_domain_uuid uuid,
  ADD COLUMN IF NOT EXISTS management_username text,
  -- Writes to FusionPBX stay OFF until a platform administrator records the PBX owners' agreement (phase 8.8).
  ADD COLUMN IF NOT EXISTS management_writes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS management_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS management_domain_name text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lemtel_pbx_connections_management_username_check') THEN
    ALTER TABLE public.lemtel_pbx_connections ADD CONSTRAINT lemtel_pbx_connections_management_username_check
      CHECK (management_username IS NULL OR management_username ~ '^[A-Za-z0-9._@+-]{1,64}$');
  END IF;
END $$;

-- Re-binding to another FusionPBX (URL or domain) drops the verification and switches writes off again.
CREATE OR REPLACE FUNCTION public.lemtel_pbx_management_rebound() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.management_base_url IS DISTINCT FROM OLD.management_base_url OR NEW.management_domain_uuid IS DISTINCT FROM OLD.management_domain_uuid
     OR NEW.management_mode IS DISTINCT FROM OLD.management_mode THEN
    NEW.management_verified_at := NULL;
    NEW.management_domain_name := NULL;
    NEW.management_writes_enabled := false;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lemtel_pbx_management_rebound ON public.lemtel_pbx_connections;
CREATE TRIGGER lemtel_pbx_management_rebound BEFORE UPDATE ON public.lemtel_pbx_connections
  FOR EACH ROW EXECUTE FUNCTION public.lemtel_pbx_management_rebound();
ALTER TABLE public.lemtel_pbx_connections DROP CONSTRAINT IF EXISTS lemtel_pbx_connections_management_domain_name_check;
ALTER TABLE public.lemtel_pbx_connections ADD CONSTRAINT lemtel_pbx_connections_management_domain_name_check
  CHECK (management_domain_name IS NULL OR management_domain_name ~ '^[a-z0-9.-]{3,253}$');

-- Secret kinds: + fusionpbx_web_password (FusionPBX web session, only for recording downloads).
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.lemtel_pbx_connection_secrets'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%secret_kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.lemtel_pbx_connection_secrets DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE public.lemtel_pbx_connection_secrets ADD CONSTRAINT lemtel_pbx_connection_secrets_kind_check
    CHECK (secret_kind IN ('turn_shared_secret', 'fusionpbx_api_key', 'fusionpbx_web_password'));
END $$;

-- Append-only record of every telephony management operation (who, what, which resource, outcome; never a value).
CREATE TABLE IF NOT EXISTS public.lemtel_pbx_operation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action ~ '^[a-z_]{3,48}$'),
  resource text CHECK (resource IS NULL OR resource ~ '^[a-z_]{2,48}$'),
  resource_uuid uuid,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'refused', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(metadata::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS lemtel_pbx_operation_audit_org_idx ON public.lemtel_pbx_operation_audit (organization_id, created_at DESC);
ALTER TABLE public.lemtel_pbx_operation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_pbx_operation_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.lemtel_pbx_operation_audit TO service_role;

-- Local, organization-scoped copy of FusionPBX call detail records (the FusionPBX v7 API cannot sort or
-- filter by date, so history, filters, exports and statistics run on this copy). No recording audio, no path.
CREATE TABLE IF NOT EXISTS public.lemtel_pbx_cdr (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  xml_cdr_uuid uuid NOT NULL,
  direction text CHECK (direction IS NULL OR direction IN ('inbound', 'outbound', 'local')),
  caller_id_name text CHECK (caller_id_name IS NULL OR length(caller_id_name) <= 128),
  caller_id_number text CHECK (caller_id_number IS NULL OR length(caller_id_number) <= 64),
  destination_number text CHECK (destination_number IS NULL OR length(destination_number) <= 64),
  extension_uuid uuid,
  start_at timestamptz,
  answer_at timestamptz,
  end_at timestamptz,
  duration integer CHECK (duration IS NULL OR duration >= 0),
  billsec integer CHECK (billsec IS NULL OR billsec >= 0),
  hangup_cause text CHECK (hangup_cause IS NULL OR hangup_cause ~ '^[A-Z_]{1,64}$'),
  missed_call boolean NOT NULL DEFAULT false,
  record_name text CHECK (record_name IS NULL OR record_name ~ '^[A-Za-z0-9._-]{1,128}$'),
  synced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, xml_cdr_uuid)
);
CREATE INDEX IF NOT EXISTS lemtel_pbx_cdr_org_start_idx ON public.lemtel_pbx_cdr (organization_id, start_at DESC);
ALTER TABLE public.lemtel_pbx_cdr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_pbx_cdr FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lemtel_pbx_cdr TO service_role;

-- Rolling synchronization cursor per organization and resource.
CREATE TABLE IF NOT EXISTS public.lemtel_pbx_sync_state (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  resource text NOT NULL CHECK (resource ~ '^[a-z_]{2,32}$'),
  cursor_offset integer NOT NULL DEFAULT 0 CHECK (cursor_offset >= 0),
  last_run_at timestamptz,
  last_outcome text CHECK (last_outcome IS NULL OR last_outcome ~ '^[a-z_]{2,48}$'),
  rows_seen integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, resource)
);
ALTER TABLE public.lemtel_pbx_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_pbx_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lemtel_pbx_sync_state TO service_role;

-- Statistics for one organization over a period (server-side aggregation, counts only).
CREATE OR REPLACE FUNCTION public.lemtel_pbx_cdr_stats(target_organization_id uuid, from_at timestamptz, to_at timestamptz, tz text DEFAULT 'America/Toronto')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH c AS (
    SELECT * FROM public.lemtel_pbx_cdr
    WHERE organization_id = target_organization_id AND start_at >= from_at AND start_at < to_at
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM c),
    'answered', (SELECT count(*) FROM c WHERE billsec > 0),
    'missed', (SELECT count(*) FROM c WHERE missed_call OR (direction = 'inbound' AND coalesce(billsec, 0) = 0)),
    'inbound', (SELECT count(*) FROM c WHERE direction = 'inbound'),
    'outbound', (SELECT count(*) FROM c WHERE direction = 'outbound'),
    'local', (SELECT count(*) FROM c WHERE direction = 'local'),
    'talkSeconds', (SELECT coalesce(sum(billsec), 0) FROM c),
    'averageTalkSeconds', (SELECT coalesce(round(avg(billsec) FILTER (WHERE billsec > 0)), 0) FROM c),
    'recorded', (SELECT count(*) FROM c WHERE record_name IS NOT NULL),
    'byDay', coalesce((SELECT jsonb_agg(d ORDER BY d->>'day') FROM (
        SELECT jsonb_build_object('day', to_char(start_at AT TIME ZONE tz, 'YYYY-MM-DD'), 'total', count(*),
          'answered', count(*) FILTER (WHERE billsec > 0), 'missed', count(*) FILTER (WHERE missed_call OR (direction = 'inbound' AND coalesce(billsec, 0) = 0))) AS d
        FROM c GROUP BY to_char(start_at AT TIME ZONE tz, 'YYYY-MM-DD')) x), '[]'::jsonb),
    'byHour', coalesce((SELECT jsonb_agg(h ORDER BY (h->>'hour')::int) FROM (
        SELECT jsonb_build_object('hour', extract(hour FROM start_at AT TIME ZONE tz)::int, 'total', count(*)) AS h
        FROM c GROUP BY extract(hour FROM start_at AT TIME ZONE tz)) y), '[]'::jsonb),
    'byCause', coalesce((SELECT jsonb_agg(k ORDER BY (k->>'total')::int DESC) FROM (
        SELECT jsonb_build_object('cause', coalesce(hangup_cause, 'UNKNOWN'), 'total', count(*)) AS k
        FROM c GROUP BY hangup_cause ORDER BY count(*) DESC LIMIT 10) z), '[]'::jsonb),
    'topNumbers', coalesce((SELECT jsonb_agg(t ORDER BY (t->>'total')::int DESC) FROM (
        SELECT jsonb_build_object('number', n, 'total', count(*), 'talkSeconds', coalesce(sum(billsec), 0)) AS t FROM (
          SELECT CASE WHEN direction = 'inbound' THEN destination_number ELSE caller_id_number END AS n, billsec FROM c) q
        WHERE n IS NOT NULL GROUP BY n ORDER BY count(*) DESC LIMIT 10) w), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.lemtel_pbx_cdr_stats(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_pbx_cdr_stats(uuid, timestamptz, timestamptz, text) TO service_role;

COMMIT;
