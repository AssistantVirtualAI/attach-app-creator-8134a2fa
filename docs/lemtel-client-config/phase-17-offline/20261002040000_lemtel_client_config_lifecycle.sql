-- OFFLINE SOURCE (not applied). Lemtel Phase 17: configuration-only device lifecycle metadata.
-- Additive and idempotent. Never stores credentials, endpoints, push tokens, call data or audio.
-- Only the authenticated lemtel-client-config server function owns lifecycle operations.

CREATE TABLE IF NOT EXISTS public.lemtel_client_config_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_ref text NOT NULL DEFAULT ('dev_' || replace(gen_random_uuid()::text, '-', '')),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  softphone_user_id uuid NOT NULL REFERENCES public.pbx_softphone_users(id),
  platform text NOT NULL,
  installation_ref_hash text NOT NULL,
  state text NOT NULL DEFAULT 'approved',
  revision integer NOT NULL DEFAULT 1,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_ccd_device_ref_key UNIQUE (device_ref),
  CONSTRAINT lemtel_ccd_logical_device_key UNIQUE (user_id, platform, installation_ref_hash),
  CONSTRAINT lemtel_ccd_platform_check CHECK (platform IN ('mobile', 'desktop')),
  CONSTRAINT lemtel_ccd_state_check CHECK (state IN ('approved', 'pending', 'revoked')),
  CONSTRAINT lemtel_ccd_revision_check CHECK (revision > 0),
  CONSTRAINT lemtel_ccd_device_ref_format_check CHECK (device_ref ~ '^dev_[0-9a-f]{32}$'),
  CONSTRAINT lemtel_ccd_hash_check CHECK (installation_ref_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS lemtel_ccd_user_platform_idx ON public.lemtel_client_config_devices (user_id, platform);
CREATE INDEX IF NOT EXISTS lemtel_ccd_organization_idx ON public.lemtel_client_config_devices (organization_id);
CREATE INDEX IF NOT EXISTS lemtel_ccd_device_ref_idx ON public.lemtel_client_config_devices (device_ref);

REVOKE ALL ON public.lemtel_client_config_devices FROM anon;
REVOKE ALL ON public.lemtel_client_config_devices FROM authenticated;
GRANT ALL ON public.lemtel_client_config_devices TO service_role;

ALTER TABLE public.lemtel_client_config_devices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.lemtel_client_config_devices IS
  'Lemtel configuration-only device lifecycle. Only the authenticated lemtel-client-config server function owns lifecycle operations; no direct client access. Stores no credentials, endpoints, push tokens, call data or audio.';
COMMENT ON COLUMN public.lemtel_client_config_devices.installation_ref_hash IS
  'One-way SHA-256 digest of the submitted installation reference; the plaintext is never retained.';
COMMENT ON COLUMN public.lemtel_client_config_devices.device_ref IS
  'Server-generated opaque reference; never user-controlled.';
