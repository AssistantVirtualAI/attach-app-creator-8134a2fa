GRANT UPDATE (status) ON public.planipret_profiles TO authenticated;
ALTER TABLE public.planipret_profiles DROP CONSTRAINT IF EXISTS planipret_profiles_status_allowed;
ALTER TABLE public.planipret_profiles ADD CONSTRAINT planipret_profiles_status_allowed
  CHECK (status IS NULL OR status IN ('available','busy','meeting','dnd','break','lunch','away','training','remote','offline')) NOT VALID;