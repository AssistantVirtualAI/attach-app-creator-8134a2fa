ALTER TABLE public.planipret_profiles ADD COLUMN IF NOT EXISTS previous_maestro_broker_id text;

CREATE OR REPLACE FUNCTION public.planipret_track_previous_maestro_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.maestro_broker_id IS DISTINCT FROM NEW.maestro_broker_id
     AND OLD.maestro_broker_id IS NOT NULL
     AND NEW.maestro_broker_id IS DISTINCT FROM OLD.maestro_broker_id THEN
    NEW.previous_maestro_broker_id := OLD.maestro_broker_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pp_previous_maestro_id ON public.planipret_profiles;
CREATE TRIGGER trg_pp_previous_maestro_id
BEFORE UPDATE ON public.planipret_profiles
FOR EACH ROW
EXECUTE FUNCTION public.planipret_track_previous_maestro_id();