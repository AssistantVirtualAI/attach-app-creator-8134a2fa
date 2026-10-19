-- Lemtel PBX connection (FusionPBX) — source package; applied only through an approved deployment.
-- Ringotel-like model: one connection profile per organization, one extension assignment per user.
-- Secrets (TURN shared secret, FusionPBX API key, extension SIP passwords) are stored ONLY as AES-256-GCM
-- ciphertext produced by the Edge Function with a key that never enters the database. No table is readable
-- by anon/authenticated: every access goes through service-role Edge Functions that enforce membership.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_pbx_connections (
  organization_id uuid PRIMARY KEY REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  vendor text NOT NULL DEFAULT 'fusionpbx' CHECK (vendor = 'fusionpbx'),
  sip_domain text NOT NULL CHECK (sip_domain ~ '^[a-z0-9.-]{3,253}$'),
  pbx_host text NOT NULL CHECK (pbx_host ~ '^[a-z0-9.-]{3,253}$'),
  sip_transport text NOT NULL CHECK (sip_transport IN ('udp', 'tcp', 'tls')),
  sip_port integer NOT NULL CHECK (sip_port BETWEEN 1 AND 65535),
  wss_url text NOT NULL CHECK (wss_url ~ '^wss://[a-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'),
  outbound_proxy text CHECK (outbound_proxy IS NULL OR outbound_proxy ~ '^[a-z0-9.-]+:[0-9]{1,5}$'),
  stun_urls text[] NOT NULL DEFAULT '{}' CHECK (cardinality(stun_urls) <= 4),
  turn_urls text[] NOT NULL DEFAULT '{}' CHECK (cardinality(turn_urls) <= 4),
  registration_expires integer NOT NULL DEFAULT 300 CHECK (registration_expires BETWEEN 60 AND 3600),
  codecs text[] NOT NULL DEFAULT '{opus,PCMU,PCMA}' CHECK (cardinality(codecs) BETWEEN 1 AND 5),
  srtp_mode text NOT NULL DEFAULT 'dtls_srtp' CHECK (srtp_mode IN ('dtls_srtp', 'sdes', 'none')),
  management_mode text NOT NULL DEFAULT 'none' CHECK (management_mode IN ('none', 'fusionpbx_api')),
  management_base_url text CHECK (management_base_url IS NULL OR management_base_url ~ '^https://'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'validated', 'active', 'suspended')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 100000000),
  last_validation jsonb,
  validated_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.lemtel_pbx_connection_secrets (
  organization_id uuid NOT NULL REFERENCES public.lemtel_pbx_connections(organization_id) ON DELETE CASCADE,
  secret_kind text NOT NULL CHECK (secret_kind IN ('turn_shared_secret', 'fusionpbx_api_key')),
  ciphertext text NOT NULL CHECK (ciphertext ~ '^v[0-9]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'),
  set_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  set_by uuid NOT NULL,
  PRIMARY KEY (organization_id, secret_kind)
);

CREATE TABLE IF NOT EXISTS public.lemtel_pbx_extension_assignments (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  extension text NOT NULL CHECK (extension ~ '^[0-9]{2,8}$'),
  auth_username text CHECK (auth_username IS NULL OR auth_username ~ '^[A-Za-z0-9._@+-]{1,64}$'),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 64),
  is_test boolean NOT NULL DEFAULT false,
  sip_password_ciphertext text CHECK (sip_password_ciphertext IS NULL OR sip_password_ciphertext ~ '^v[0-9]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'),
  credential_revision integer NOT NULL DEFAULT 0 CHECK (credential_revision BETWEEN 0 AND 100000000),
  credential_set_at timestamptz,
  state text NOT NULL DEFAULT 'assigned' CHECK (state IN ('assigned', 'suspended')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  UNIQUE (organization_id, extension)
);

-- Append-only audit: what changed and by whom, never a value of a secret.
CREATE TABLE IF NOT EXISTS public.lemtel_pbx_connection_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'settings_saved', 'secret_set', 'secret_cleared', 'extension_assigned', 'extension_credential_set',
    'extension_unassigned', 'validation_run', 'connection_activated', 'connection_suspended', 'credential_delivered')),
  subject_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(metadata::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS lemtel_pbx_connection_audit_org_idx ON public.lemtel_pbx_connection_audit (organization_id, created_at DESC);

ALTER TABLE public.lemtel_pbx_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_pbx_connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_pbx_extension_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_pbx_connection_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_pbx_connections, public.lemtel_pbx_connection_secrets,
  public.lemtel_pbx_extension_assignments, public.lemtel_pbx_connection_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lemtel_pbx_connections, public.lemtel_pbx_connection_secrets,
  public.lemtel_pbx_extension_assignments TO service_role;
GRANT SELECT, INSERT ON TABLE public.lemtel_pbx_connection_audit TO service_role;

-- Any settings change invalidates a previous validation: activation always follows a validation of what is saved.
CREATE OR REPLACE FUNCTION public.lemtel_pbx_connection_settings_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW.sip_domain, NEW.pbx_host, NEW.sip_transport, NEW.sip_port, NEW.wss_url, NEW.outbound_proxy, NEW.stun_urls, NEW.turn_urls,
      NEW.registration_expires, NEW.codecs, NEW.srtp_mode, NEW.management_mode, NEW.management_base_url)
     IS DISTINCT FROM
     (OLD.sip_domain, OLD.pbx_host, OLD.sip_transport, OLD.sip_port, OLD.wss_url, OLD.outbound_proxy, OLD.stun_urls, OLD.turn_urls,
      OLD.registration_expires, OLD.codecs, OLD.srtp_mode, OLD.management_mode, OLD.management_base_url) THEN
    NEW.revision := OLD.revision + 1;
    IF OLD.state IN ('validated', 'active') THEN NEW.state := 'draft'; END IF;
    NEW.last_validation := NULL;
    NEW.validated_at := NULL;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lemtel_pbx_connection_settings_changed ON public.lemtel_pbx_connections;
CREATE TRIGGER lemtel_pbx_connection_settings_changed BEFORE UPDATE ON public.lemtel_pbx_connections
  FOR EACH ROW EXECUTE FUNCTION public.lemtel_pbx_connection_settings_changed();

COMMENT ON TABLE public.lemtel_pbx_connections IS 'Lemtel-only FusionPBX connection profile per organization. Non-secret fields only.';
COMMENT ON TABLE public.lemtel_pbx_connection_secrets IS 'AES-256-GCM ciphertext only; the key lives in the Edge Function environment.';
COMMENT ON TABLE public.lemtel_pbx_extension_assignments IS 'User to extension mapping; SIP password stored as ciphertext bound to (organization, user, extension).';

COMMIT;
