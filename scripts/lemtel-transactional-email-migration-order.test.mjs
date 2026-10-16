import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const migration = readFileSync(resolve(root, 'infra/lemtel-self-hosted/migrations/0019_lemtel_transactional_email_delivery_states.sql'), 'utf8');
const position = (value) => {
  const index = migration.indexOf(value);
  assert.ok(index >= 0, `missing migration statement: ${value}`);
  return index;
};

test('transactional email migration lifts legacy state constraints before mapping sent records', () => {
  const begin = position('BEGIN;');
  const onboardingDrop = position('ALTER TABLE public.lemtel_onboarding_delivery_attempts\n  DROP CONSTRAINT IF EXISTS lemtel_onboarding_delivery_state_check;');
  const resetDrop = position('ALTER TABLE public.lemtel_password_reset_delivery_attempts\n  DROP CONSTRAINT IF EXISTS lemtel_password_reset_delivery_state_check;');
  const onboardingUpdate = position("UPDATE public.lemtel_onboarding_delivery_attempts\n   SET state = 'provider_accepted'\n WHERE state = 'sent';");
  const resetUpdate = position("UPDATE public.lemtel_password_reset_delivery_attempts\n   SET state = 'provider_accepted'\n WHERE state = 'sent';");
  const onboardingAdd = position('ALTER TABLE public.lemtel_onboarding_delivery_attempts\n  ADD CONSTRAINT lemtel_onboarding_delivery_state_check');
  const resetAdd = position('ALTER TABLE public.lemtel_password_reset_delivery_attempts\n  ADD CONSTRAINT lemtel_password_reset_delivery_state_check');
  const commit = position('COMMIT;');

  assert.ok(begin < onboardingDrop);
  assert.ok(begin < resetDrop);
  assert.ok(Math.max(onboardingDrop, resetDrop) < Math.min(onboardingUpdate, resetUpdate));
  assert.ok(Math.max(onboardingUpdate, resetUpdate) < onboardingAdd);
  assert.ok(Math.max(onboardingUpdate, resetUpdate) < resetAdd);
  assert.ok(Math.max(onboardingAdd, resetAdd) < commit);
});

test('final delivery-state constraints exclude legacy sent and accept only declared states', () => {
  const expected = "CHECK (state IN ('pending', 'provider_accepted', 'delivered', 'failed', 'needs_attention'))";
  assert.equal((migration.match(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 2);
  const finalConstraintSection = migration.slice(position('ALTER TABLE public.lemtel_onboarding_delivery_attempts\n  ADD CONSTRAINT lemtel_onboarding_delivery_state_check'));
  assert.doesNotMatch(finalConstraintSection, /CHECK \(state IN \([^)]*'sent'/u);
});
