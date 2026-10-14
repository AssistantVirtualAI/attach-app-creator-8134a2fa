DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.proname, p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('planipret_grant_broker_role','planipret_mplanipret_allowed','planipret_signin_eligible','pp_feedback_reports_guard')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn.signature);
    IF fn.proname IN ('planipret_mplanipret_allowed', 'planipret_signin_eligible') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.signature);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', fn.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END IF;
  END LOOP;
END $$;