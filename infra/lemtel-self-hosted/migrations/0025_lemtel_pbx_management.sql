-- Lemtel phase 8 — FusionPBX management binding and operation audit (idempotent; applies twice).
-- One organization = one FusionPBX domain (domain_uuid). The REST API key stays in lemtel_pbx_connection_secrets,
-- encrypted; the optional web password (recording downloads) is a new write-only secret kind.
BEGIN;

ALTER TABLE public.lemtel_pbx_connections
  ADD COLUMN IF NOT EXISTS management_domain_uuid uuid,
  ADD COLUMN IF NOT EXISTS management_username text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lemtel_pbx_connections_management_username_check') THEN
    ALTER TABLE public.lemtel_pbx_connections ADD CONSTRAINT lemtel_pbx_connections_management_username_check
      CHECK (management_username IS NULL OR management_username ~ '^[A-Za-z0-9._@+-]{1,64}$');
  END IF;
END $$;

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

COMMIT;
