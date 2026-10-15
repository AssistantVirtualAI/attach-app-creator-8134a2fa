CREATE TABLE public.planipret_billing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('queue','ivr')),
  ns_domain text NOT NULL DEFAULT 'planipret.ca',
  ns_id text NOT NULL,
  name text,
  monthly_price numeric(10,2) NOT NULL DEFAULT 11.99,
  activation_fee numeric(10,2) NOT NULL DEFAULT 100.00,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  UNIQUE (kind, ns_domain, ns_id)
);
GRANT SELECT ON public.planipret_billing_items TO authenticated;
GRANT ALL ON public.planipret_billing_items TO service_role;
ALTER TABLE public.planipret_billing_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read billing items" ON public.planipret_billing_items FOR SELECT TO authenticated
  USING (public.is_planipret_admin(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.planipret_billing_snapshots (
  month date PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz
);
GRANT SELECT ON public.planipret_billing_snapshots TO authenticated;
GRANT ALL ON public.planipret_billing_snapshots TO service_role;
ALTER TABLE public.planipret_billing_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read billing snapshots" ON public.planipret_billing_snapshots FOR SELECT TO authenticated
  USING (public.is_planipret_admin(auth.uid()) OR public.is_super_admin(auth.uid()));

-- Private per-job trigger token (service_role only; never exposed to clients)
CREATE TABLE public.planipret_billing_trigger (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex')
);
GRANT ALL ON public.planipret_billing_trigger TO service_role;
ALTER TABLE public.planipret_billing_trigger ENABLE ROW LEVEL SECURITY;
INSERT INTO public.planipret_billing_trigger DEFAULT VALUES;

CREATE OR REPLACE FUNCTION public.pp_run_billing_monthly()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','net' AS $$
DECLARE _t text;
BEGIN
  SELECT token INTO _t FROM public.planipret_billing_trigger WHERE id = 1;
  IF _t IS NULL THEN RETURN; END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://gejxisrqtvxavbrfcoxz.supabase.co/functions/v1/pp-billing-monthly',
      headers := jsonb_build_object('Content-Type','application/json','X-Billing-Trigger',_t),
      body := '{"action":"monthly"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
REVOKE ALL ON FUNCTION public.pp_run_billing_monthly() FROM PUBLIC, anon, authenticated;