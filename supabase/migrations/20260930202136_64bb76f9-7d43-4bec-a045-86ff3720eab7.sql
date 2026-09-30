-- Lemtel UC phase 0: only one first platform administrator, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS luc_memberships_single_platform_admin
  ON public.luc_memberships ((true)) WHERE role = 'platform_admin';

CREATE OR REPLACE FUNCTION public.luc_bootstrap_platform_admin(_user_id uuid, _email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('luc_bootstrap_platform_admin'));
  INSERT INTO public.luc_memberships (user_id, tenant_id, role, email)
  VALUES (_user_id, NULL, 'platform_admin', _email)
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.luc_bootstrap_platform_admin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.luc_bootstrap_platform_admin(uuid, text) TO service_role;