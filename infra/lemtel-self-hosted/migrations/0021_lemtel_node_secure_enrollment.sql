-- Lemtel-only source. No application, secret creation, accounts, runtime or route changes.
BEGIN;
CREATE TABLE public.lemtel_node_enrollments (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_role text NOT NULL CHECK (node_role IN ('do_writer', 'hostinger_standby')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('invited', 'pending', 'approved', 'delivered', 'revoked')),
  nonce text NOT NULL CHECK (nonce ~ '^[a-f0-9]{64}$'),
  expires_at bigint NOT NULL,
  granted_until bigint,
  signing_key text CHECK (signing_key ~ '^[A-Za-z0-9_-]{87}$'),
  encryption_key text CHECK (encryption_key ~ '^[A-Za-z0-9_-]{87}$'),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'invited' AND signing_key IS NULL AND encryption_key IS NULL AND granted_until IS NULL)
    OR (state = 'pending' AND signing_key IS NOT NULL AND encryption_key IS NOT NULL AND granted_until IS NULL)
    OR (state IN ('approved', 'delivered') AND signing_key IS NOT NULL AND encryption_key IS NOT NULL AND granted_until IS NOT NULL)
    OR state = 'revoked')
);
-- Expired grants still occupy the slot: explicit revocation is required, never silent replacement.
CREATE UNIQUE INDEX lemtel_node_one_publication_grant ON public.lemtel_node_enrollments(node_role)
  WHERE state IN ('approved', 'delivered');
CREATE UNIQUE INDEX lemtel_node_unique_challenge_nonce ON public.lemtel_node_enrollments(nonce);
CREATE TABLE public.lemtel_node_enrollment_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.lemtel_node_enrollments(request_id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event IN ('invited', 'attested_possession_only', 'approved_publication_only', 'claimed', 'revoked')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.lemtel_node_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_node_enrollment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_node_enrollments, public.lemtel_node_enrollment_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.lemtel_node_enrollment_audit_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.lemtel_node_enrollment_is_admin(p_actor uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.lemtel_platform_administrators WHERE user_id = p_actor AND status = 'active');
$$;
CREATE FUNCTION public.lemtel_node_enrollment_require_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Lock membership for the entire mutation/read transaction: concurrent revocation cannot race approval.
  PERFORM 1 FROM public.lemtel_platform_administrators WHERE user_id = p_actor AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
END;
$$;
CREATE FUNCTION public.lemtel_node_enrollment_redacted(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('requestId', request_id, 'role', node_role, 'fingerprint', fingerprint,
    'expiresAt', CASE WHEN state = 'delivered' THEN granted_until ELSE expires_at END,
    'state', CASE
      WHEN state = 'revoked' THEN 'revoked'
      WHEN (state = 'delivered' AND granted_until <= floor(extract(epoch FROM clock_timestamp())))
        OR (state <> 'delivered' AND expires_at <= floor(extract(epoch FROM clock_timestamp()))) THEN 'expired'
      WHEN state = 'invited' THEN 'invited_unverified'
      WHEN state = 'pending' THEN 'pending_unverified'
      WHEN state = 'approved' THEN 'approved_publication_only'
      WHEN state = 'delivered' THEN 'delivered_publication_only' END)
  FROM public.lemtel_node_enrollments WHERE request_id = p_id;
$$;
CREATE FUNCTION public.lemtel_node_enrollment_invite(p_actor uuid, p_role text, p_fingerprint text, p_confirmation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_now bigint := floor(extract(epoch FROM clock_timestamp()));
BEGIN
  PERFORM public.lemtel_node_enrollment_require_admin(p_actor);
  IF p_confirmation IS DISTINCT FROM 'PIN_OUT_OF_BAND_PUBLIC_KEY' OR p_role IS NULL OR p_role NOT IN ('do_writer', 'hostinger_standby')
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^sha256:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lemtel-node-invite:' || p_role, 0));
  IF (SELECT count(*) FROM public.lemtel_node_enrollments WHERE node_role = p_role AND state IN ('invited', 'pending') AND expires_at > v_now) >= 16
    THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  INSERT INTO public.lemtel_node_enrollments(node_role, fingerprint, state, nonce, expires_at)
    VALUES(p_role, p_fingerprint, 'invited', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), v_now + 300) RETURNING request_id INTO v_id;
  INSERT INTO public.lemtel_node_enrollment_audit(request_id, event, actor_id) VALUES(v_id, 'invited', p_actor);
  RETURN public.lemtel_node_enrollment_redacted(v_id);
END;
$$;
CREATE FUNCTION public.lemtel_node_enrollment_read(p_actor uuid, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.lemtel_node_enrollment_require_admin(p_actor);
  v := public.lemtel_node_enrollment_redacted(p_id);
  IF v IS NULL THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION public.lemtel_node_enrollment_challenge(p_id uuid, p_role text, p_fingerprint text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('challenge', jsonb_build_object('requestId', request_id, 'role', node_role, 'fingerprint', fingerprint,
    'purpose', CASE WHEN state = 'invited' THEN 'attest' ELSE 'claim' END, 'nonce', nonce, 'expiresAt', expires_at),
    'descriptor', CASE WHEN state = 'approved' THEN jsonb_build_object('signingKey', signing_key, 'encryptionKey', encryption_key) ELSE NULL END,
    'grantedUntil', granted_until)
  FROM public.lemtel_node_enrollments WHERE request_id = p_id AND node_role = p_role AND fingerprint = p_fingerprint
    AND state IN ('invited', 'approved') AND expires_at > floor(extract(epoch FROM clock_timestamp()))
    AND (state = 'invited' OR granted_until > floor(extract(epoch FROM clock_timestamp())));
$$;
CREATE FUNCTION public.lemtel_node_enrollment_attest(p_id uuid, p_role text, p_fingerprint text, p_nonce text, p_signing_key text, p_encryption_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_signing_key IS NULL OR p_encryption_key IS NULL OR p_signing_key = p_encryption_key
    OR p_signing_key !~ '^[A-Za-z0-9_-]{87}$' OR p_encryption_key !~ '^[A-Za-z0-9_-]{87}$' THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  -- Edge first verifies curve validity, full descriptor digest and ECDSA proof of possession.
  UPDATE public.lemtel_node_enrollments SET state = 'pending', signing_key = p_signing_key, encryption_key = p_encryption_key
    WHERE request_id = p_id AND node_role = p_role AND fingerprint = p_fingerprint AND nonce = p_nonce
      AND state = 'invited' AND expires_at > floor(extract(epoch FROM clock_timestamp()));
  IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  INSERT INTO public.lemtel_node_enrollment_audit(request_id, event) VALUES(p_id, 'attested_possession_only');
  RETURN true;
END;
$$;
CREATE FUNCTION public.lemtel_node_enrollment_approve(p_actor uuid, p_id uuid, p_role text, p_fingerprint text, p_confirmation text, p_evidence text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_now bigint := floor(extract(epoch FROM clock_timestamp()));
BEGIN
  PERFORM public.lemtel_node_enrollment_require_admin(p_actor);
  IF p_confirmation IS DISTINCT FROM 'APPROVE_PUBLICATION_ONLY' OR p_evidence IS DISTINCT FROM 'OUT_OF_BAND_KEY_VERIFIED' THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  UPDATE public.lemtel_node_enrollments SET state = 'approved', nonce = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    expires_at = v_now + 300, granted_until = v_now + 3600
    WHERE request_id = p_id AND node_role = p_role AND fingerprint = p_fingerprint AND state = 'pending' AND expires_at > v_now;
  IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  INSERT INTO public.lemtel_node_enrollment_audit(request_id, event, actor_id) VALUES(p_id, 'approved_publication_only', p_actor);
  RETURN public.lemtel_node_enrollment_redacted(p_id);
END;
$$;
CREATE FUNCTION public.lemtel_node_enrollment_revoke(p_actor uuid, p_id uuid, p_role text, p_fingerprint text, p_confirmation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.lemtel_node_enrollment_require_admin(p_actor);
  IF p_confirmation IS DISTINCT FROM 'REVOKE_PUBLICATION_ONLY' THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  UPDATE public.lemtel_node_enrollments SET state = 'revoked'
    WHERE request_id = p_id AND node_role = p_role AND fingerprint = p_fingerprint AND state <> 'revoked';
  IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  INSERT INTO public.lemtel_node_enrollment_audit(request_id, event, actor_id) VALUES(p_id, 'revoked', p_actor);
  RETURN public.lemtel_node_enrollment_redacted(p_id);
END;
$$;
CREATE FUNCTION public.lemtel_node_enrollment_claim(p_id uuid, p_role text, p_fingerprint text, p_nonce text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.lemtel_node_enrollments SET state = 'delivered' WHERE request_id = p_id AND node_role = p_role AND fingerprint = p_fingerprint AND nonce = p_nonce
    AND state = 'approved' AND expires_at > floor(extract(epoch FROM clock_timestamp())) AND granted_until > floor(extract(epoch FROM clock_timestamp()));
  IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  INSERT INTO public.lemtel_node_enrollment_audit(request_id, event) VALUES(p_id, 'claimed');
  RETURN true;
END;
$$;
CREATE FUNCTION public.lemtel_node_publication_lookup(p_id uuid, p_role text, p_fingerprint text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('descriptor', jsonb_build_object('signingKey', signing_key, 'encryptionKey', encryption_key), 'grantedUntil', granted_until)
    FROM public.lemtel_node_enrollments WHERE request_id = p_id AND node_role = p_role AND fingerprint = p_fingerprint AND state = 'delivered'
      AND granted_until > floor(extract(epoch FROM clock_timestamp()));
$$;
CREATE FUNCTION public.lemtel_record_enrolled_node_status(p_id uuid, p_role text, p_fingerprint text, p_sequence bigint,
  p_observed_at timestamptz, p_agent_state text, p_runtime_state text, p_replication_state text, p_storage_state text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_sequence IS NULL OR p_sequence < 1 OR p_sequence > 9007199254740991 OR p_observed_at IS NULL OR p_observed_at > clock_timestamp()
    OR p_observed_at < clock_timestamp() - interval '180 seconds'
    OR p_agent_state IS NULL OR p_agent_state NOT IN ('healthy', 'degraded', 'unknown')
    OR p_runtime_state IS NULL OR p_runtime_state NOT IN ('ready', 'degraded', 'unknown')
    OR p_replication_state IS NULL OR p_replication_state NOT IN ('streaming', 'degraded', 'unknown')
    OR p_storage_state IS NULL OR p_storage_state NOT IN ('synced', 'degraded', 'unknown') THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  UPDATE public.lemtel_node_enrollments SET last_sequence = p_sequence WHERE request_id = p_id AND node_role = p_role AND fingerprint = p_fingerprint
    AND state = 'delivered' AND granted_until > floor(extract(epoch FROM clock_timestamp())) AND last_sequence < p_sequence;
  IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_rejected'; END IF;
  -- Transactional sequence consumption and the same six-column redacted snapshot as PR #275.
  PERFORM public.lemtel_record_node_status(p_role, p_observed_at, p_agent_state, p_runtime_state, p_replication_state, p_storage_state);
  RETURN true;
END;
$$;

-- No browser/table access, including for platform admins. Edge verifies Auth and uses service-only RPCs.
REVOKE ALL ON FUNCTION public.lemtel_node_enrollment_require_admin(uuid), public.lemtel_node_enrollment_redacted(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lemtel_node_enrollment_is_admin(uuid), public.lemtel_node_enrollment_invite(uuid,text,text,text),
  public.lemtel_node_enrollment_read(uuid,uuid), public.lemtel_node_enrollment_challenge(uuid,text,text),
  public.lemtel_node_enrollment_attest(uuid,text,text,text,text,text), public.lemtel_node_enrollment_approve(uuid,uuid,text,text,text,text),
  public.lemtel_node_enrollment_revoke(uuid,uuid,text,text,text), public.lemtel_node_enrollment_claim(uuid,text,text,text),
  public.lemtel_node_publication_lookup(uuid,text,text), public.lemtel_record_enrolled_node_status(uuid,text,text,bigint,timestamptz,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lemtel_node_enrollment_is_admin(uuid), public.lemtel_node_enrollment_invite(uuid,text,text,text),
  public.lemtel_node_enrollment_read(uuid,uuid), public.lemtel_node_enrollment_challenge(uuid,text,text),
  public.lemtel_node_enrollment_attest(uuid,text,text,text,text,text), public.lemtel_node_enrollment_approve(uuid,uuid,text,text,text,text),
  public.lemtel_node_enrollment_revoke(uuid,uuid,text,text,text), public.lemtel_node_enrollment_claim(uuid,text,text,text),
  public.lemtel_node_publication_lookup(uuid,text,text), public.lemtel_record_enrolled_node_status(uuid,text,text,bigint,timestamptz,text,text,text,text)
  TO service_role;
COMMENT ON TABLE public.lemtel_node_enrollments IS 'Lemtel publication-only opaque grants. Public keys and proof of possession do not authenticate infrastructure identity; explicit platform-admin out-of-band pinning and approval are mandatory. No topology or private keys.';
COMMENT ON TABLE public.lemtel_node_enrollment_audit IS 'Minimal request/event/admin/time ledger. No nonce, key, ciphertext, proof, error, hostname or IP. Observation events are not logged here.';
COMMIT;
