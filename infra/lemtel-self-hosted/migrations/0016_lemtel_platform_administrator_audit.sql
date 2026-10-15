-- Lemtel platform-administrator audit: server-only, no accounts or access are changed by this migration.
BEGIN;
CREATE TABLE IF NOT EXISTS public.lemtel_platform_administrator_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('platform_administrator_granted', 'platform_administrator_revoked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lemtel_platform_administrator_audit_subject_idx ON public.lemtel_platform_administrator_audit (subject_user_id, created_at DESC);
REVOKE ALL ON TABLE public.lemtel_platform_administrator_audit FROM PUBLIC, anon, authenticated;
ALTER TABLE public.lemtel_platform_administrator_audit ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.lemtel_platform_administrator_audit IS 'Lemtel-only server audit for platform administrator grants and revocations. No tokens, passwords or IP addresses are stored.';
COMMIT;
