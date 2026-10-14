-- Lemtel organization domains — source package only. Do not apply without separate target-write approval.
-- This migration records tenant-owned access domains. It does not create DNS records, route traffic,
-- provision PBX services, import shared data, or expose data to anon/authenticated roles.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_organization_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  verification_status text NOT NULL DEFAULT 'unverified',
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_organization_domains_hostname_check CHECK (
    hostname = lower(hostname)
    AND length(hostname) BETWEEN 4 AND 253
    AND hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT lemtel_organization_domains_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT lemtel_organization_domains_verification_check CHECK (verification_status IN ('unverified', 'verified')),
  CONSTRAINT lemtel_organization_domains_hostname_key UNIQUE (hostname)
);

CREATE INDEX IF NOT EXISTS lemtel_organization_domains_organization_idx
  ON public.lemtel_organization_domains (organization_id, status, hostname);

REVOKE ALL ON public.lemtel_organization_domains FROM anon, authenticated;
ALTER TABLE public.lemtel_organization_domains ENABLE ROW LEVEL SECURITY;

-- Edge Functions use the service role after explicit actor and organization-admin checks.
-- No direct browser/table access is permitted.

ALTER TABLE public.lemtel_onboarding_audit
  DROP CONSTRAINT IF EXISTS lemtel_onboarding_audit_action_check;
ALTER TABLE public.lemtel_onboarding_audit
  ADD CONSTRAINT lemtel_onboarding_audit_action_check CHECK (action IN (
    'organization_created',
    'user_provisioned',
    'welcome_sent',
    'welcome_failed',
    'welcome_resent',
    'temporary_password_rotated',
    'user_access_suspended',
    'domain_created',
    'domain_suspended',
    'domain_reactivated'
  ));

COMMIT;
