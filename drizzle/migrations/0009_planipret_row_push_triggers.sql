-- Lock-screen alerts for new SMS, missed calls and voicemails whatever path
-- stored them. Only { table, id } is sent; pp-row-push re-reads the row with
-- the service role and dedupes with the webhook path's idempotency keys.
CREATE OR REPLACE FUNCTION public.pp_row_push_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://gejxisrqtvxavbrfcoxz.supabase.co/functions/v1/pp-row-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdlanhpc3JxdHZ4YXZicmZjb3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MDMxNzQsImV4cCI6MjA3NzA3OTE3NH0.kaO-GslE99OCNrZ4_AMnbzGqya2azqz_UMZR34zZvvo'
      ),
      body := jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    -- A push must never block storing a call, SMS or voicemail.
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pp_row_push_notify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pp_row_push_notify() TO service_role;

DROP TRIGGER IF EXISTS trg_pp_row_push_sms ON public.planipret_phone_messages;
CREATE TRIGGER trg_pp_row_push_sms
AFTER INSERT ON public.planipret_phone_messages
FOR EACH ROW WHEN (NEW.direction = 'inbound')
EXECUTE FUNCTION public.pp_row_push_notify();

DROP TRIGGER IF EXISTS trg_pp_row_push_missed_ins ON public.planipret_phone_calls;
CREATE TRIGGER trg_pp_row_push_missed_ins
AFTER INSERT ON public.planipret_phone_calls
FOR EACH ROW WHEN (
  NEW.direction = 'inbound' AND NEW.answered_at IS NULL AND COALESCE(NEW.duration_seconds, 0) = 0
  AND (NEW.status = 'missed' OR NEW.ended_at IS NOT NULL)
)
EXECUTE FUNCTION public.pp_row_push_notify();

DROP TRIGGER IF EXISTS trg_pp_row_push_missed_upd ON public.planipret_phone_calls;
CREATE TRIGGER trg_pp_row_push_missed_upd
AFTER UPDATE OF status, ended_at, answered_at, duration_seconds ON public.planipret_phone_calls
FOR EACH ROW WHEN (
  NEW.direction = 'inbound' AND NEW.answered_at IS NULL AND COALESCE(NEW.duration_seconds, 0) = 0
  AND (NEW.status = 'missed' OR NEW.ended_at IS NOT NULL)
  AND NOT (OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.ended_at IS NOT DISTINCT FROM NEW.ended_at)
)
EXECUTE FUNCTION public.pp_row_push_notify();

DROP TRIGGER IF EXISTS trg_pp_row_push_voicemail ON public.planipret_voicemails;
CREATE TRIGGER trg_pp_row_push_voicemail
AFTER INSERT ON public.planipret_voicemails
FOR EACH ROW
EXECUTE FUNCTION public.pp_row_push_notify();