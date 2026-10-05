-- Lemtel private directory and WSS diagnostic schema — OFFLINE ONLY.
-- This creates empty Lemtel-owned tables. It imports no Planiprêt data, no PBX data,
-- no Auth users, no Storage objects, and no external endpoint configuration.

BEGIN;

CREATE TABLE public.lemtel_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'device',
  external_id text NOT NULL,
  full_name text NOT NULL,
  phone_e164 text NOT NULL,
  phone_label text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_contacts_source_check CHECK (source IN ('device')),
  CONSTRAINT lemtel_contacts_external_id_check CHECK (external_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$'),
  CONSTRAINT lemtel_contacts_name_check CHECK (char_length(full_name) BETWEEN 1 AND 160),
  CONSTRAINT lemtel_contacts_phone_check CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT lemtel_contacts_label_check CHECK (phone_label IS NULL OR char_length(phone_label) BETWEEN 1 AND 64),
  CONSTRAINT lemtel_contacts_email_check CHECK (email IS NULL OR (char_length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1)),
  CONSTRAINT lemtel_contacts_private_source_key UNIQUE (organization_id, owner_user_id, source, external_id, phone_e164)
);

CREATE TABLE public.lemtel_wss_diagnostic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_endpoint_id text NOT NULL,
  fallback_endpoint_id text NOT NULL,
  primary_failure_code text NOT NULL,
  primary_latency_ms integer NOT NULL,
  fallback_state text NOT NULL,
  fallback_latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_wss_endpoint_id_check CHECK (primary_endpoint_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$' AND fallback_endpoint_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT lemtel_wss_distinct_endpoint_check CHECK (primary_endpoint_id <> fallback_endpoint_id),
  CONSTRAINT lemtel_wss_failure_code_check CHECK (primary_failure_code IN ('timeout', 'rejected', 'closed', 'tls', 'unknown')),
  CONSTRAINT lemtel_wss_latency_check CHECK (primary_latency_ms BETWEEN 0 AND 30000 AND fallback_latency_ms BETWEEN 0 AND 30000),
  CONSTRAINT lemtel_wss_fallback_state_check CHECK (fallback_state IN ('ok', 'fail'))
);

CREATE INDEX lemtel_contacts_private_lookup_idx
  ON public.lemtel_contacts (organization_id, owner_user_id, phone_e164, updated_at DESC);
CREATE INDEX lemtel_contacts_private_list_idx
  ON public.lemtel_contacts (organization_id, owner_user_id, updated_at DESC);
CREATE INDEX lemtel_wss_diagnostic_events_lookup_idx
  ON public.lemtel_wss_diagnostic_events (organization_id, actor_user_id, created_at DESC);

REVOKE ALL ON public.lemtel_contacts FROM anon, authenticated;
REVOKE ALL ON public.lemtel_wss_diagnostic_events FROM anon, authenticated;

ALTER TABLE public.lemtel_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_wss_diagnostic_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY lemtel_contacts_select_owner
  ON public.lemtel_contacts
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND public.lemtel_is_active_member(organization_id));

CREATE POLICY lemtel_wss_diagnostic_events_select_actor
  ON public.lemtel_wss_diagnostic_events
  FOR SELECT TO authenticated
  USING (actor_user_id = auth.uid() AND public.lemtel_is_active_member(organization_id));

COMMENT ON TABLE public.lemtel_contacts IS
  'Private, owner-scoped Lemtel contacts. Empty schema only; device contacts are never imported without explicit in-app consent and an approved Edge deployment.';
COMMENT ON TABLE public.lemtel_wss_diagnostic_events IS
  'Minimized Lemtel WSS fallback telemetry. Stores endpoint identifiers and bounded outcomes only; never raw WSS URLs, SIP credentials, or request bodies.';

COMMIT;
