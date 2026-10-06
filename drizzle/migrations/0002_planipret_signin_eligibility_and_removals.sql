CREATE OR REPLACE FUNCTION public.planipret_signin_eligible(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.planipret_profiles p
    JOIN public.planipret_did_assignments d
      ON d.extension = COALESCE(NULLIF(p.ns_extension,''), p.extension)
     AND d.status = 'assigned'
    WHERE p.user_id = _user_id
      AND COALESCE(NULLIF(p.ns_extension,''), p.extension) IS NOT NULL
  );
$$;
GRANT EXECUTE ON FUNCTION public.planipret_signin_eligible(uuid) TO authenticated, service_role;

CREATE TABLE public.planipret_user_removals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_label text NOT NULL,
  first_name text, last_name text,
  email text, extension text, callerid_number text,
  status text NOT NULL DEFAULT 'pending',
  profile_found boolean, ns_found boolean,
  ns_result jsonb, portal_result jsonb, error text,
  executed_by uuid, executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.planipret_user_removals TO authenticated;
GRANT ALL ON public.planipret_user_removals TO service_role;
ALTER TABLE public.planipret_user_removals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Planipret admins read removals" ON public.planipret_user_removals
  FOR SELECT TO authenticated USING (public.is_planipret_admin(auth.uid()) OR public.is_super_admin(auth.uid()));