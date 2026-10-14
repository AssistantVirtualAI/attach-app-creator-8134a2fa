-- Ferme l'exécution anonyme résiduelle de helpers Planiprêt SECURITY DEFINER.
-- Les applications ne lisent les règles d'accès qu'après authentification ; les
-- fonctions Edge les lisent avec service_role. Les helpers d'écriture et les
-- triggers ne sont jamais exécutables directement par un courtier.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.proname, p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'planipret_grant_broker_role',
        'planipret_mplanipret_allowed',
        'planipret_signin_eligible',
        'pp_feedback_reports_guard'
      )
  LOOP
    -- PUBLIC inclut anon : retirer les deux rôles ferme l'accès visiteur.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn.signature);

    IF fn.proname IN ('planipret_mplanipret_allowed', 'planipret_signin_eligible') THEN
      -- Ces deux prédicats sont appelés après auth.getSession() par le portail
      -- et l'application, puis depuis des Edge Functions avec service_role.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.signature);
    ELSE
      -- Attribution de rôle et trigger de feedback : serveur seulement.
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', fn.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END IF;
  END LOOP;
END
$$;
