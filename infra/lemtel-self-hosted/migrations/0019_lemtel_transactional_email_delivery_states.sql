-- Lemtel transactional email delivery states — OFFLINE ONLY; do not apply without a separate approved target-write.
-- This migration is Lemtel-only. It stores no plaintext password, mail body, webhook payload,
-- provider credential or recipient data beyond the existing authorized onboarding record.
-- `provider_accepted` means only that Resend accepted an API request. `delivered` requires a signed webhook.

BEGIN;

-- Preserve existing historical records while eliminating the misleading legacy `sent` state.
UPDATE public.lemtel_onboarding_delivery_attempts
   SET state = 'provider_accepted'
 WHERE state = 'sent';
UPDATE public.lemtel_password_reset_delivery_attempts
   SET state = 'provider_accepted'
 WHERE state = 'sent';

ALTER TABLE public.lemtel_onboarding_delivery_attempts
  DROP CONSTRAINT IF EXISTS lemtel_onboarding_delivery_state_check;
ALTER TABLE public.lemtel_onboarding_delivery_attempts
  ADD CONSTRAINT lemtel_onboarding_delivery_state_check
  CHECK (state IN ('pending', 'provider_accepted', 'delivered', 'failed', 'needs_attention'));
ALTER TABLE public.lemtel_onboarding_delivery_attempts
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_attention_at timestamptz;

ALTER TABLE public.lemtel_password_reset_delivery_attempts
  DROP CONSTRAINT IF EXISTS lemtel_password_reset_delivery_state_check;
ALTER TABLE public.lemtel_password_reset_delivery_attempts
  ADD CONSTRAINT lemtel_password_reset_delivery_state_check
  CHECK (state IN ('pending', 'provider_accepted', 'delivered', 'failed', 'needs_attention'));
ALTER TABLE public.lemtel_password_reset_delivery_attempts
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_attention_at timestamptz;

ALTER TABLE public.lemtel_onboarding_audit
  DROP CONSTRAINT IF EXISTS lemtel_onboarding_audit_action_check;
ALTER TABLE public.lemtel_onboarding_audit
  ADD CONSTRAINT lemtel_onboarding_audit_action_check CHECK (
    action IN (
      'organization_created', 'user_provisioned', 'welcome_sent', 'welcome_failed', 'welcome_resent',
      'welcome_provider_accepted', 'welcome_delivery_failed', 'first_password_changed',
      'temporary_password_rotated', 'organization_updated', 'organization_archived', 'domain_created',
      'domain_suspended', 'domain_reactivated', 'user_access_suspended', 'membership_assigned',
      'membership_reactivated', 'membership_role_changed', 'organization_ownership_transferred',
      'client_session_access_revoked', 'client_session_access_reactivated'
    )
  );

CREATE INDEX IF NOT EXISTS lemtel_onboarding_delivery_provider_message_idx
  ON public.lemtel_onboarding_delivery_attempts (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lemtel_password_reset_delivery_provider_message_idx
  ON public.lemtel_password_reset_delivery_attempts (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON COLUMN public.lemtel_onboarding_delivery_attempts.state IS
  'pending, provider_accepted, delivered, failed or needs_attention. Provider acceptance is not inbox delivery.';
COMMENT ON COLUMN public.lemtel_password_reset_delivery_attempts.state IS
  'pending, provider_accepted, delivered, failed or needs_attention. Provider acceptance is not inbox delivery.';

COMMIT;
