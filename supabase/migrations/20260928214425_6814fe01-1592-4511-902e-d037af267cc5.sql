CREATE TABLE public.planipret_marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_user_id uuid NOT NULL,
  broker_name text,
  channels text[] NOT NULL DEFAULT '{}',
  subject text,
  email_html text,
  sms_text text,
  prompt text,
  status text NOT NULL DEFAULT 'draft',
  total_email integer NOT NULL DEFAULT 0,
  total_sms integer NOT NULL DEFAULT 0,
  sent_email integer NOT NULL DEFAULT 0,
  sent_sms integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  opened_count integer NOT NULL DEFAULT 0,
  clicked_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.planipret_marketing_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.planipret_marketing_campaigns(id) ON DELETE CASCADE,
  client_id text,
  client_name text,
  phone text,
  email text,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  error text,
  track_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX planipret_marketing_recipients_token_key ON public.planipret_marketing_recipients(track_token);
CREATE INDEX planipret_marketing_recipients_campaign_idx ON public.planipret_marketing_recipients(campaign_id);
CREATE INDEX planipret_marketing_campaigns_broker_idx ON public.planipret_marketing_campaigns(broker_user_id, created_at DESC);

CREATE TABLE public.planipret_marketing_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX planipret_marketing_optouts_email_key ON public.planipret_marketing_optouts(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX planipret_marketing_optouts_phone_key ON public.planipret_marketing_optouts(phone) WHERE phone IS NOT NULL;

GRANT SELECT ON public.planipret_marketing_campaigns TO authenticated;
GRANT ALL ON public.planipret_marketing_campaigns TO service_role;
GRANT SELECT ON public.planipret_marketing_recipients TO authenticated;
GRANT ALL ON public.planipret_marketing_recipients TO service_role;
GRANT SELECT ON public.planipret_marketing_optouts TO authenticated;
GRANT ALL ON public.planipret_marketing_optouts TO service_role;

ALTER TABLE public.planipret_marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planipret_marketing_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planipret_marketing_optouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marketing campaigns readable by owner or planipret admin"
ON public.planipret_marketing_campaigns FOR SELECT TO authenticated
USING (broker_user_id = auth.uid() OR public.is_planipret_admin(auth.uid()));

CREATE POLICY "marketing recipients readable by owner or planipret admin"
ON public.planipret_marketing_recipients FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.planipret_marketing_campaigns c
  WHERE c.id = campaign_id
    AND (c.broker_user_id = auth.uid() OR public.is_planipret_admin(auth.uid()))
));

CREATE POLICY "marketing optouts readable by planipret members"
ON public.planipret_marketing_optouts FOR SELECT TO authenticated
USING (public.is_planipret_member(auth.uid()));

CREATE TRIGGER planipret_marketing_campaigns_updated_at
BEFORE UPDATE ON public.planipret_marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION public.planipret_set_updated_at();

CREATE TRIGGER planipret_marketing_recipients_updated_at
BEFORE UPDATE ON public.planipret_marketing_recipients
FOR EACH ROW EXECUTE FUNCTION public.planipret_set_updated_at();