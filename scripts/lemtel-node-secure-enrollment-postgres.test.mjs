import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
// Optional test-only dependency @electric-sql/pglite. No database URL or runtime configuration.
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const repo = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(repo, path), 'utf8');
const actor = '22222222-2222-4222-8222-222222222222', outsider = '33333333-3333-4333-8333-333333333333';
const fp = 'sha256:' + 'a'.repeat(64), otherFP = 'sha256:' + 'b'.repeat(64);
const sign = 'A'.repeat(87), enc = 'B'.repeat(87); // Mock public points: SQL trusts the separately tested crypto Edge.

test('real PostgreSQL engine: isolated enrollment schema and transactional capabilities', async (t) => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${actor}'), ('${outsider}');
    CREATE TABLE public.lemtel_platform_administrators(user_id uuid PRIMARY KEY REFERENCES auth.users(id), status text NOT NULL);
    INSERT INTO public.lemtel_platform_administrators VALUES ('${actor}', 'active');`);
  await db.exec(read('infra/lemtel-self-hosted/migrations/0020_lemtel_node_status_observations.sql'));
  await db.exec(read('infra/lemtel-self-hosted/migrations/0021_lemtel_node_secure_enrollment.sql'));
  const rpc = async (name, ...params) => (await db.query(`SELECT public.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) AS value`, params)).rows[0].value;
  const invite = (role = 'do_writer', fingerprint = fp) => rpc('lemtel_node_enrollment_invite', actor, role, fingerprint, 'PIN_OUT_OF_BAND_PUBLIC_KEY');
  const challenge = (id, role = 'do_writer', fingerprint = fp) => rpc('lemtel_node_enrollment_challenge', id, role, fingerprint);
  const attest = (id, nonce, role = 'do_writer', fingerprint = fp) => rpc('lemtel_node_enrollment_attest', id, role, fingerprint, nonce, sign, enc);
  const approve = (id, role = 'do_writer', fingerprint = fp, admin = actor) => rpc('lemtel_node_enrollment_approve', admin, id, role, fingerprint, 'APPROVE_PUBLICATION_ONLY', 'OUT_OF_BAND_KEY_VERIFIED');
  const claim = (id, nonce, role = 'do_writer', fingerprint = fp) => rpc('lemtel_node_enrollment_claim', id, role, fingerprint, nonce);
  const revoke = (id, role = 'do_writer', fingerprint = fp) => rpc('lemtel_node_enrollment_revoke', actor, id, role, fingerprint, 'REVOKE_PUBLICATION_ONLY');
  let item, firstNonce, grant;
  await t.test('RLS and no direct browser/service table access, service-only constrained RPCs', async () => {
    const rel = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname IN ('lemtel_node_enrollments','lemtel_node_enrollment_audit')`)).rows;
    assert.equal(rel.length, 2); assert.ok(rel.every((v) => v.relrowsecurity));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await db.query(`SELECT has_table_privilege('${role}', 'public.lemtel_node_enrollments', 'SELECT') AS value`)).rows[0].value, false);
    }
    for (const role of ['anon', 'authenticated']) {
      const rows = (await db.query(`SELECT has_function_privilege('${role}', oid, 'EXECUTE') AS permitted FROM pg_proc WHERE proname LIKE 'lemtel_node_enrollment_%' OR proname IN ('lemtel_node_publication_lookup','lemtel_record_enrolled_node_status')`)).rows;
      assert.ok(rows.length >= 12); assert.ok(rows.every((v) => !v.permitted));
    }
    assert.equal((await db.query("SELECT has_function_privilege('service_role','public.lemtel_node_enrollment_redacted(uuid)','EXECUTE') AS value")).rows[0].value, false);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(() => db.query('SELECT * FROM public.lemtel_node_enrollments'));
    await assert.rejects(() => rpc('lemtel_node_enrollment_read', actor, '11111111-1111-4111-8111-111111111111'));
    await db.exec('RESET ROLE');
  });
  await t.test('unknown/non-platform admin, invalid role/fingerprint and unapproved requests are refused', async () => {
    await assert.rejects(() => rpc('lemtel_node_enrollment_invite', outsider, 'do_writer', fp, 'PIN_OUT_OF_BAND_PUBLIC_KEY'));
    await assert.rejects(() => invite('arbitrary', fp)); await assert.rejects(() => invite('do_writer', 'bad'));
    await assert.rejects(() => rpc('lemtel_node_enrollment_read', actor, '11111111-1111-4111-8111-111111111111'));
    item = await invite(); assert.equal(item.state, 'invited_unverified');
    assert.deepEqual(Object.keys(item).sort(), ['expiresAt','fingerprint','requestId','role','state'].sort());
    await assert.rejects(() => approve(item.requestId));
    grant = await challenge(item.requestId); firstNonce = grant.challenge.nonce;
    assert.equal(grant.challenge.purpose, 'attest'); assert.equal(grant.descriptor, null);
    await assert.rejects(() => claim(item.requestId, firstNonce));
  });
  await t.test('exact role, full fingerprint, nonce, one-use attestation and pending-unverified state', async () => {
    await assert.rejects(() => attest(item.requestId, firstNonce, 'hostinger_standby'));
    await assert.rejects(() => attest(item.requestId, firstNonce, 'do_writer', otherFP));
    await assert.rejects(() => attest(item.requestId, '0'.repeat(64)));
    assert.equal(await attest(item.requestId, firstNonce), true);
    await assert.rejects(() => attest(item.requestId, firstNonce));
    assert.equal(await challenge(item.requestId), null);
    const v = await rpc('lemtel_node_enrollment_read', actor, item.requestId); assert.equal(v.state, 'pending_unverified');
  });
  await t.test('explicit platform approval, independent pin, revocation recheck and no duplicate approval', async () => {
    await assert.rejects(() => approve(item.requestId, 'do_writer', otherFP));
    await assert.rejects(() => approve(item.requestId, 'do_writer', fp, outsider));
    await assert.rejects(() => rpc('lemtel_node_enrollment_approve', actor, item.requestId, 'do_writer', fp, 'APPROVE_PUBLICATION_ONLY', 'SELF_ASSERTED'));
    await db.query("UPDATE public.lemtel_platform_administrators SET status='revoked' WHERE user_id=$1", [actor]);
    await assert.rejects(() => approve(item.requestId));
    await db.query("UPDATE public.lemtel_platform_administrators SET status='active' WHERE user_id=$1", [actor]);
    const v = await approve(item.requestId); assert.equal(v.state, 'approved_publication_only');
    await assert.rejects(() => approve(item.requestId));
    grant = await challenge(item.requestId); assert.equal(grant.challenge.purpose, 'claim'); assert.notEqual(grant.challenge.nonce, firstNonce);
    await assert.rejects(() => claim(item.requestId, firstNonce));
  });
  await t.test('one active grant per role, atomic audit failure rollback, one-shot competing claims', async () => {
    const duplicate = await invite(); const c = await challenge(duplicate.requestId); await attest(duplicate.requestId, c.challenge.nonce);
    await assert.rejects(() => approve(duplicate.requestId));
    await db.exec(`CREATE FUNCTION public.synthetic_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$;
      CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON public.lemtel_node_enrollment_audit FOR EACH ROW EXECUTE FUNCTION public.synthetic_audit_failure();`);
    await assert.rejects(() => claim(item.requestId, grant.challenge.nonce));
    assert.equal((await challenge(item.requestId)).challenge.purpose, 'claim');
    await db.exec('DROP TRIGGER synthetic_audit_failure ON public.lemtel_node_enrollment_audit; DROP FUNCTION public.synthetic_audit_failure();');
    const results = await Promise.allSettled([claim(item.requestId, grant.challenge.nonce), claim(item.requestId, grant.challenge.nonce)]);
    assert.equal(results.filter((v) => v.status === 'fulfilled').length, 1);
    assert.equal(await challenge(item.requestId), null);
    await assert.rejects(() => claim(item.requestId, grant.challenge.nonce));
  });
  await t.test('observation replay, sequence, enum/date mismatch and grant revocation', async () => {
    const date = new Date(); date.setUTCSeconds(0, 0); const stamp = date.toISOString();
    const observe = (sequence, state = 'unknown', fingerprint = fp, role = 'do_writer') => rpc('lemtel_record_enrolled_node_status', item.requestId, role, fingerprint, sequence, stamp, state, 'unknown', 'unknown', 'unknown');
    await assert.rejects(() => observe(0)); await assert.rejects(() => observe(1, 'ready')); await assert.rejects(() => observe(1, 'unknown', otherFP));
    assert.equal(await observe(1), true); await assert.rejects(() => observe(1));
    const results = await Promise.allSettled([observe(2), observe(2)]); assert.equal(results.filter((v) => v.status === 'fulfilled').length, 1);
    assert.equal((await db.query('SELECT last_sequence FROM public.lemtel_node_enrollments WHERE request_id=$1', [item.requestId])).rows[0].last_sequence, 2);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM public.lemtel_node_status_current')).rows[0].count, 1);
    assert.equal((await revoke(item.requestId)).state, 'revoked');
    assert.equal(await rpc('lemtel_node_publication_lookup', item.requestId, 'do_writer', fp), null);
    await assert.rejects(() => observe(3));
  });
  await t.test('expired invitation, approval and claim; absent state and null ambiguity fail closed', async () => {
    const v = await invite('hostinger_standby'); const c = await challenge(v.requestId, 'hostinger_standby');
    await db.query('UPDATE public.lemtel_node_enrollments SET expires_at=1 WHERE request_id=$1', [v.requestId]);
    assert.equal(await challenge(v.requestId, 'hostinger_standby'), null);
    await assert.rejects(() => attest(v.requestId, c.challenge.nonce, 'hostinger_standby'));
    assert.equal((await rpc('lemtel_node_enrollment_read', actor, v.requestId)).state, 'expired');
    const pending = await invite('hostinger_standby'); const pc = await challenge(pending.requestId, 'hostinger_standby'); await attest(pending.requestId, pc.challenge.nonce, 'hostinger_standby');
    await db.query('UPDATE public.lemtel_node_enrollments SET expires_at=1 WHERE request_id=$1', [pending.requestId]);
    await assert.rejects(() => approve(pending.requestId, 'hostinger_standby'));
    const approved = await invite('hostinger_standby'); const ac = await challenge(approved.requestId, 'hostinger_standby'); await attest(approved.requestId, ac.challenge.nonce, 'hostinger_standby'); await approve(approved.requestId, 'hostinger_standby');
    const cc = await challenge(approved.requestId, 'hostinger_standby'); await db.query('UPDATE public.lemtel_node_enrollments SET expires_at=1 WHERE request_id=$1', [approved.requestId]);
    await assert.rejects(() => claim(approved.requestId, cc.challenge.nonce, 'hostinger_standby'));
    await assert.rejects(() => rpc('lemtel_node_enrollment_approve', actor, null, null, null, null, null));
    const fields = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='lemtel_node_enrollment_audit'")).rows.map((v) => v.column_name);
    assert.deepEqual(fields.sort(), ['audit_id','request_id','event','actor_id','recorded_at'].sort());
  });
  await db.close();
});
