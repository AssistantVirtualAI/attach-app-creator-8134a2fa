CREATE TABLE public.planipret_mplanipret_exceptions (
  user_id uuid PRIMARY KEY,
  email text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.planipret_mplanipret_exceptions TO service_role;
ALTER TABLE public.planipret_mplanipret_exceptions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.planipret_mplanipret_allowed(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR public.is_planipret_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.planipret_mplanipret_exceptions WHERE user_id = _user_id)
$$;
GRANT EXECUTE ON FUNCTION public.planipret_mplanipret_allowed(uuid) TO authenticated;

INSERT INTO public.planipret_mplanipret_exceptions (user_id, email, note)
VALUES ('970ac25b-d5d9-4b31-906a-e5260b0c1b8e', 'tmastroberardino@planipret.com', 'Exception courtière');