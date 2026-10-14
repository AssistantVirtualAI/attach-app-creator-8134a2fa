-- Lemtel operational status history — source package only.
-- Retains redacted enum/timestamp snapshots for platform-administrator charts.
-- It stores no addresses, credentials, user data, traffic payload, call content, recording or telephony configuration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_operational_status_history (
  observed_at timestamptz PRIMARY KEY,
  overall_status text NOT NULL CHECK (overall_status IN ('healthy', 'degraded', 'unknown')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lemtel_operational_status_history_observed_at_idx
  ON public.lemtel_operational_status_history (observed_at DESC);

ALTER TABLE public.lemtel_operational_status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_operational_status_history FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.lemtel_operational_status_history IS
  'Lemtel-only redacted health timeline for platform-administrator availability charts. Raw traffic telemetry and sensitive server details are intentionally excluded.';

COMMIT;
