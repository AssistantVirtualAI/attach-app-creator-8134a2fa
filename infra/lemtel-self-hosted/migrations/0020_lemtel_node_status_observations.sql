-- Lemtel node-status observations only. Offline source; applying requires separate approval.
-- Permitted fields are limited to role, UTC minute, and fixed redacted state enums.
BEGIN;

CREATE TABLE public.lemtel_node_status_current (
  node_role text PRIMARY KEY CHECK (node_role IN ('do_writer', 'hostinger_standby')),
  observed_at timestamptz NOT NULL CHECK (
    observed_at >= '2026-01-01T00:00:00Z'::timestamptz
    AND observed_at < '2100-01-01T00:00:00Z'::timestamptz
    AND observed_at = date_trunc('minute', observed_at)
  ),
  agent_state text NOT NULL CHECK (agent_state IN ('healthy', 'degraded', 'unknown')),
  runtime_state text NOT NULL CHECK (runtime_state IN ('ready', 'degraded', 'unknown')),
  replication_state text NOT NULL CHECK (replication_state IN ('streaming', 'degraded', 'unknown')),
  storage_state text NOT NULL CHECK (storage_state IN ('synced', 'degraded', 'unknown'))
);

CREATE TABLE public.lemtel_node_status_history (
  node_role text NOT NULL CHECK (node_role IN ('do_writer', 'hostinger_standby')),
  observed_at timestamptz NOT NULL CHECK (
    observed_at >= '2026-01-01T00:00:00Z'::timestamptz
    AND observed_at < '2100-01-01T00:00:00Z'::timestamptz
    AND observed_at = date_trunc('minute', observed_at)
  ),
  agent_state text NOT NULL CHECK (agent_state IN ('healthy', 'degraded', 'unknown')),
  runtime_state text NOT NULL CHECK (runtime_state IN ('ready', 'degraded', 'unknown')),
  replication_state text NOT NULL CHECK (replication_state IN ('streaming', 'degraded', 'unknown')),
  storage_state text NOT NULL CHECK (storage_state IN ('synced', 'degraded', 'unknown')),
  PRIMARY KEY (node_role, observed_at)
);
CREATE INDEX lemtel_node_status_history_observed_at_idx
  ON public.lemtel_node_status_history (observed_at DESC, node_role);

-- No browser policy exists. The private Edge service role may read current state only.
ALTER TABLE public.lemtel_node_status_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_node_status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_node_status_current FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.lemtel_node_status_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lemtel_node_status_current TO service_role;

CREATE FUNCTION public.lemtel_node_status_history_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.observed_at < clock_timestamp() - interval '180 seconds'
     OR NEW.observed_at > clock_timestamp() + interval '120 seconds' THEN
    RAISE EXCEPTION 'lemtel_node_status_clock_skew' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.lemtel_node_status_history
    WHERE observed_at < clock_timestamp() - interval '48 hours';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lemtel_node_status_history_retention() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER lemtel_node_status_history_retention_before_insert
  BEFORE INSERT ON public.lemtel_node_status_history
  FOR EACH ROW EXECUTE FUNCTION public.lemtel_node_status_history_retention();

-- The Edge invokes one narrow write capability. It cannot store opaque payloads or identifiers.
CREATE FUNCTION public.lemtel_record_node_status(
  p_node_role text,
  p_observed_at timestamptz,
  p_agent_state text,
  p_runtime_state text,
  p_replication_state text,
  p_storage_state text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.lemtel_node_status_history (
    node_role, observed_at, agent_state, runtime_state, replication_state, storage_state
  ) VALUES (
    p_node_role, p_observed_at, p_agent_state, p_runtime_state, p_replication_state, p_storage_state
  ) ON CONFLICT (node_role, observed_at) DO NOTHING;

  -- Current state never moves backwards when a delayed, still-valid minute arrives.
  INSERT INTO public.lemtel_node_status_current (
    node_role, observed_at, agent_state, runtime_state, replication_state, storage_state
  ) VALUES (
    p_node_role, p_observed_at, p_agent_state, p_runtime_state, p_replication_state, p_storage_state
  ) ON CONFLICT (node_role) DO UPDATE SET
    observed_at = EXCLUDED.observed_at,
    agent_state = EXCLUDED.agent_state,
    runtime_state = EXCLUDED.runtime_state,
    replication_state = EXCLUDED.replication_state,
    storage_state = EXCLUDED.storage_state
  WHERE EXCLUDED.observed_at >= public.lemtel_node_status_current.observed_at;
END;
$$;
REVOKE ALL ON FUNCTION public.lemtel_record_node_status(text, timestamptz, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lemtel_record_node_status(text, timestamptz, text, text, text, text) TO service_role;

COMMENT ON TABLE public.lemtel_node_status_current IS
  'Lemtel-only current redacted node observations: role, UTC minute, agent/runtime/replication/storage enum states only. No identifiers, network data, errors, metrics, clients, telephony, or content.';
COMMENT ON TABLE public.lemtel_node_status_history IS
  'Lemtel-only redacted node observation history. At most two roles per minute with 48-hour retention on insertion; browser roles have no access.';
COMMIT;
