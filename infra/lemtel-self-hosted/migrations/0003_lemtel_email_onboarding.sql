-- Lemtel self-hosted email onboarding package — OFFLINE ONLY; do not apply without a separate target-write approval.
-- Creates only Lemtel-owned onboarding metadata. It does not import Planiprêt data,
-- mutate FusionPBX, send email, create Auth users, or expose any credentials by itself.

BEGIN;

ALTER TABLE public.lemtel_organizations
  ADD COLUMN IF NOT EXISTS default_locale text NOT NULL DEFAULT 'fr';

ALTER TABLE public.lemtel_organizations
  DROP CONSTRAINT IF EXISTS lemtel_organizations_default_locale_check;
ALTER TABLE public.lemtel_organizations
  ADD CONSTRAINT lemtel_organizations_default_locale_check
  CHECK (default_locale IN ('fr', 'en'));

CREATE TABLE IF NOT EXISTS public.lemtel_platform_administrators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT lemtel_platform_administrators_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE TABLE IF NOT EXISTS public.lemtel_onboarding_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  recipient_role text NOT NULL,
  locale text NOT NULL,
  delivery_kind text NOT NULL DEFAULT 'welcome',
  state text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  attempted_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_onboarding_delivery_role_check CHECK (recipient_role IN ('owner', 'admin', 'member')),
  CONSTRAINT lemtel_onboarding_delivery_locale_check CHECK (locale IN ('fr', 'en')),
  CONSTRAINT lemtel_onboarding_delivery_kind_check CHECK (delivery_kind IN ('welcome', 'welcome_resend')),
  CONSTRAINT lemtel_onboarding_delivery_state_check CHECK (state IN ('pending', 'sent', 'failed')),
  CONSTRAINT lemtel_onboarding_delivery_email_check CHECK (recipient_email = lower(recipient_email))
);

CREATE TABLE IF NOT EXISTS public.lemtel_onboarding_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_onboarding_audit_action_check CHECK (
    action IN ('organization_created', 'user_provisioned', 'welcome_sent', 'welcome_failed', 'welcome_resent', 'first_password_changed')
  )
);

CREATE INDEX IF NOT EXISTS lemtel_onboarding_delivery_recipient_idx
  ON public.lemtel_onboarding_delivery_attempts (organization_id, recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lemtel_onboarding_delivery_state_idx
  ON public.lemtel_onboarding_delivery_attempts (state, created_at DESC);
CREATE INDEX IF NOT EXISTS lemtel_onboarding_audit_organization_idx
  ON public.lemtel_onboarding_audit (organization_id, created_at DESC);

REVOKE ALL ON public.lemtel_platform_administrators FROM anon, authenticated;
REVOKE ALL ON public.lemtel_onboarding_delivery_attempts FROM anon, authenticated;
REVOKE ALL ON public.lemtel_onboarding_audit FROM anon, authenticated;

ALTER TABLE public.lemtel_platform_administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_onboarding_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_onboarding_audit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.lemtel_platform_administrators IS
  'Lemtel-only platform operators permitted to create tenant organizations. The first operator must be explicitly approved and inserted after Auth validation.';
COMMENT ON TABLE public.lemtel_onboarding_delivery_attempts IS
  'Lemtel welcome-email delivery metadata. Temporary passwords, Auth tokens, SMTP credentials and full email bodies are never stored here.';
COMMENT ON TABLE public.lemtel_onboarding_audit IS
  'Lemtel-only onboarding audit with minimized non-secret metadata.';

COMMIT;
