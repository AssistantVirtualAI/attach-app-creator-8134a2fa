-- Lemtel phase 3.3 — call notifications (wake the app for an incoming call). Idempotent; applies twice.
-- One row per installed app (device) and push channel. Tokens only reach Apple / Google; never returned to clients.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_push_devices (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  channel text NOT NULL CHECK (channel IN ('apns_voip', 'fcm')),
  token text NOT NULL CHECK (token ~ '^[A-Za-z0-9:_-]{32,4096}$'),
  app_version text CHECK (app_version IS NULL OR app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
  apns_environment text CHECK (apns_environment IS NULL OR apns_environment IN ('production', 'sandbox')),
  enabled boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_push_at timestamptz,
  PRIMARY KEY (organization_id, device_id, channel)
);
CREATE INDEX IF NOT EXISTS lemtel_push_devices_user_idx ON public.lemtel_push_devices (organization_id, user_id) WHERE enabled;

-- Append-only delivery record (no token, no caller number): proves pushes were sent and why some were not.
CREATE TABLE IF NOT EXISTS public.lemtel_push_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  call_ref text CHECK (call_ref IS NULL OR call_ref ~ '^[A-Za-z0-9@._-]{1,128}$'),
  extension text CHECK (extension IS NULL OR extension ~ '^[0-9]{2,8}$'),
  devices integer NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  outcome text NOT NULL CHECK (outcome ~ '^[a-z_]{2,48}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS lemtel_push_events_org_idx ON public.lemtel_push_events (organization_id, created_at DESC);

-- Replay protection for the signed SIP-edge hook (nonce kept 10 minutes).
CREATE TABLE IF NOT EXISTS public.lemtel_push_hook_nonces (
  nonce text PRIMARY KEY CHECK (nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.lemtel_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_push_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_push_hook_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_push_devices, public.lemtel_push_events, public.lemtel_push_hook_nonces FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lemtel_push_devices TO service_role;
GRANT SELECT, INSERT ON TABLE public.lemtel_push_events TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.lemtel_push_hook_nonces TO service_role;

COMMIT;
