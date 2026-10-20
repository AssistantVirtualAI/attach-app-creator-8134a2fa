-- Lemtel — announcement of each new desktop release to active users (idempotent; applies twice).
-- One row per announced version (claimed once; a partial run resumes), one row per (version, user) delivery so
-- that a retry never emails the same person twice. Only names, versions, counts and provider ids: no content.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_desktop_release_announcements (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$'),
  state text NOT NULL CHECK (state IN ('baseline', 'sending', 'partial', 'sent')),
  triggered_by text NOT NULL CHECK (triggered_by IN ('baseline', 'release_workflow', 'platform_admin')),
  recipients integer NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  accepted integer NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.lemtel_desktop_release_deliveries (
  version text NOT NULL REFERENCES public.lemtel_desktop_release_announcements(version) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('provider_accepted', 'failed')),
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (version, user_id)
);

ALTER TABLE public.lemtel_desktop_release_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_desktop_release_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_desktop_release_announcements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lemtel_desktop_release_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lemtel_desktop_release_announcements TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lemtel_desktop_release_deliveries TO service_role;

-- 2.5.22 is already in users' hands (welcome emails link it): it is the baseline, the next release is announced.
INSERT INTO public.lemtel_desktop_release_announcements (version, state, triggered_by, completed_at)
VALUES ('2.5.22', 'baseline', 'baseline', clock_timestamp())
ON CONFLICT (version) DO NOTHING;

COMMIT;
