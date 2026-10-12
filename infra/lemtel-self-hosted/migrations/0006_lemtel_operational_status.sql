-- Lemtel operational status snapshot — OFFLINE ONLY.
-- Apply only with a separate approved target-schema write on the active writer.
-- This table stores redacted health states and timestamps only: no credentials, IP addresses,
-- hostnames, user records, call data, recordings, temporary passwords, or telephony settings.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_operational_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  observed_at timestamptz NOT NULL,
  overall_status text NOT NULL CHECK (overall_status IN ('healthy', 'degraded', 'unknown')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lemtel_operational_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_operational_status FROM anon, authenticated;

COMMENT ON TABLE public.lemtel_operational_status IS
  'Lemtel-only redacted writer health snapshot for platform-administrator operational visibility. It is read only through the authenticated server function.';

COMMIT;
