CREATE TABLE public.planipret_mobile_active_device (
  user_id uuid PRIMARY KEY,
  device_id text NOT NULL,
  platform text,
  activated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.planipret_mobile_active_device TO authenticated;
GRANT ALL ON public.planipret_mobile_active_device TO service_role;
ALTER TABLE public.planipret_mobile_active_device ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own active device" ON public.planipret_mobile_active_device
  FOR SELECT TO authenticated USING (user_id = auth.uid());
ALTER PUBLICATION supabase_realtime ADD TABLE public.planipret_mobile_active_device;

ALTER TABLE public.planipret_voip_push_tokens ADD COLUMN IF NOT EXISTS device_id text, ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.mobile_push_tokens ADD COLUMN IF NOT EXISTS device_id text, ADD COLUMN IF NOT EXISTS revoked_at timestamptz;