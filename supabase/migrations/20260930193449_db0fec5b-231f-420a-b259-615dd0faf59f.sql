CREATE TYPE public.luc_role AS ENUM ('platform_admin','tenant_admin','tenant_support','end_user');

CREATE TABLE public.luc_tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'active', seat_limit int NOT NULL DEFAULT 25, branding jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, tenant_id uuid REFERENCES public.luc_tenants(id) ON DELETE CASCADE, role public.luc_role NOT NULL, display_name text, email text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, tenant_id, role));

CREATE OR REPLACE FUNCTION public.luc_is_platform_admin(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM luc_memberships WHERE user_id=_uid AND role='platform_admin') $$;
CREATE OR REPLACE FUNCTION public.luc_is_member(_uid uuid, _tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT luc_is_platform_admin(_uid) OR EXISTS(SELECT 1 FROM luc_memberships WHERE user_id=_uid AND tenant_id=_tenant) $$;
CREATE OR REPLACE FUNCTION public.luc_has_role(_uid uuid, _tenant uuid, _role public.luc_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT luc_is_platform_admin(_uid) OR EXISTS(SELECT 1 FROM luc_memberships WHERE user_id=_uid AND tenant_id=_tenant AND role=_role) $$;
CREATE OR REPLACE FUNCTION public.luc_is_staff(_uid uuid, _tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT luc_has_role(_uid,_tenant,'tenant_admin') OR luc_has_role(_uid,_tenant,'tenant_support') $$;

CREATE TABLE public.luc_devices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, user_id uuid NOT NULL, label text NOT NULL, platform text NOT NULL DEFAULT 'web', credential_status text NOT NULL DEFAULT 'none', credential_expires_at timestamptz, revoked_at timestamptz, last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_pbx_connections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, name text NOT NULL, pbx_domain text NOT NULL, mode text NOT NULL DEFAULT 'mock', credential_ciphertext text, health text NOT NULL DEFAULT 'unknown', last_checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_extension_mappings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, user_id uuid NOT NULL, pbx_connection_id uuid REFERENCES public.luc_pbx_connections(id) ON DELETE SET NULL, extension text NOT NULL, sip_credential_ciphertext text, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id, extension));
CREATE TABLE public.luc_feature_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.luc_tenants(id) ON DELETE CASCADE, key text NOT NULL, enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id, key));
CREATE TABLE public.luc_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, owner_id uuid NOT NULL, name text NOT NULL, number text, email text, favorite boolean NOT NULL DEFAULT false, speed_dial int, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, title text, kind text NOT NULL DEFAULT 'direct', created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_conversation_members (conversation_id uuid NOT NULL REFERENCES public.luc_conversations(id) ON DELETE CASCADE, user_id uuid NOT NULL, last_read_at timestamptz, PRIMARY KEY(conversation_id, user_id));
CREATE TABLE public.luc_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, conversation_id uuid NOT NULL REFERENCES public.luc_conversations(id) ON DELETE CASCADE, sender_id uuid NOT NULL, body text NOT NULL, attachment jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_call_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, user_id uuid, direction text NOT NULL, remote_number text, status text NOT NULL, duration_seconds int NOT NULL DEFAULT 0, source text NOT NULL DEFAULT 'mock', started_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_voicemails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, user_id uuid NOT NULL, caller text, duration_seconds int NOT NULL DEFAULT 0, transcription_status text NOT NULL DEFAULT 'none', read boolean NOT NULL DEFAULT false, retention_until timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_recordings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, user_id uuid, call_event_id uuid REFERENCES public.luc_call_events(id) ON DELETE SET NULL, policy_allows_playback boolean NOT NULL DEFAULT false, ai_status text NOT NULL DEFAULT 'none', retention_until timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_provisioning_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, kind text NOT NULL, status text NOT NULL DEFAULT 'queued', detail jsonb NOT NULL DEFAULT '{}', created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_push_registrations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.luc_tenants(id) ON DELETE CASCADE, device_id uuid NOT NULL REFERENCES public.luc_devices(id) ON DELETE CASCADE, provider text NOT NULL, token_ciphertext text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.luc_audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, actor_id uuid, action text NOT NULL, entity text NOT NULL, entity_id text, created_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['luc_tenants','luc_memberships','luc_devices','luc_pbx_connections','luc_extension_mappings','luc_feature_flags','luc_contacts','luc_conversations','luc_conversation_members','luc_messages','luc_call_events','luc_voicemails','luc_recordings','luc_provisioning_jobs','luc_push_registrations','luc_audit_events'] LOOP
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
END LOOP; END $$;

-- secrets never readable by clients
REVOKE SELECT ON public.luc_pbx_connections FROM authenticated;
REVOKE SELECT ON public.luc_extension_mappings FROM authenticated;
REVOKE SELECT ON public.luc_push_registrations FROM authenticated;
GRANT SELECT (id, tenant_id, name, pbx_domain, mode, health, last_checked_at, created_at) ON public.luc_pbx_connections TO authenticated;
GRANT SELECT (id, tenant_id, user_id, pbx_connection_id, extension, status, created_at) ON public.luc_extension_mappings TO authenticated;
GRANT SELECT (id, tenant_id, device_id, provider, created_at) ON public.luc_push_registrations TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.luc_pbx_connections, public.luc_extension_mappings, public.luc_push_registrations, public.luc_audit_events, public.luc_memberships, public.luc_provisioning_jobs FROM authenticated;

CREATE POLICY luc_tenants_sel ON public.luc_tenants FOR SELECT TO authenticated USING (luc_is_member(auth.uid(), id));
CREATE POLICY luc_tenants_pa ON public.luc_tenants FOR ALL TO authenticated USING (luc_is_platform_admin(auth.uid())) WITH CHECK (luc_is_platform_admin(auth.uid()));
CREATE POLICY luc_mem_sel ON public.luc_memberships FOR SELECT TO authenticated USING (user_id = auth.uid() OR luc_is_staff(auth.uid(), tenant_id) OR luc_is_platform_admin(auth.uid()));
CREATE POLICY luc_dev_sel ON public.luc_devices FOR SELECT TO authenticated USING (user_id = auth.uid() OR luc_is_staff(auth.uid(), tenant_id));
CREATE POLICY luc_pbx_sel ON public.luc_pbx_connections FOR SELECT TO authenticated USING (luc_is_staff(auth.uid(), tenant_id));
CREATE POLICY luc_ext_sel ON public.luc_extension_mappings FOR SELECT TO authenticated USING (user_id = auth.uid() OR luc_is_staff(auth.uid(), tenant_id));
CREATE POLICY luc_ff_sel ON public.luc_feature_flags FOR SELECT TO authenticated USING (tenant_id IS NULL OR luc_is_member(auth.uid(), tenant_id));
CREATE POLICY luc_ff_admin ON public.luc_feature_flags FOR ALL TO authenticated USING (luc_has_role(auth.uid(), tenant_id, 'tenant_admin')) WITH CHECK (luc_has_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE POLICY luc_contacts_own ON public.luc_contacts FOR ALL TO authenticated USING (owner_id = auth.uid() AND luc_is_member(auth.uid(), tenant_id)) WITH CHECK (owner_id = auth.uid() AND luc_is_member(auth.uid(), tenant_id));
CREATE OR REPLACE FUNCTION public.luc_in_conversation(_uid uuid, _c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM luc_conversation_members WHERE user_id=_uid AND conversation_id=_c) $$;
CREATE POLICY luc_conv_sel ON public.luc_conversations FOR SELECT TO authenticated USING (luc_in_conversation(auth.uid(), id));
CREATE POLICY luc_conv_ins ON public.luc_conversations FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND luc_is_member(auth.uid(), tenant_id));
CREATE POLICY luc_cm_sel ON public.luc_conversation_members FOR SELECT TO authenticated USING (luc_in_conversation(auth.uid(), conversation_id));
CREATE POLICY luc_cm_ins ON public.luc_conversation_members FOR INSERT TO authenticated WITH CHECK (EXISTS(SELECT 1 FROM luc_conversations c WHERE c.id=conversation_id AND c.created_by=auth.uid() AND luc_is_member(user_id, c.tenant_id)));
CREATE POLICY luc_cm_upd ON public.luc_conversation_members FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY luc_msg_sel ON public.luc_messages FOR SELECT TO authenticated USING (luc_in_conversation(auth.uid(), conversation_id));
CREATE POLICY luc_msg_ins ON public.luc_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid() AND luc_in_conversation(auth.uid(), conversation_id) AND EXISTS(SELECT 1 FROM luc_conversations c WHERE c.id=conversation_id AND c.tenant_id=luc_messages.tenant_id));
CREATE POLICY luc_calls_sel ON public.luc_call_events FOR SELECT TO authenticated USING (user_id = auth.uid() OR luc_is_staff(auth.uid(), tenant_id));
CREATE POLICY luc_vm_sel ON public.luc_voicemails FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY luc_vm_upd ON public.luc_voicemails FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY luc_rec_sel ON public.luc_recordings FOR SELECT TO authenticated USING ((user_id = auth.uid() AND policy_allows_playback) OR luc_has_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE POLICY luc_jobs_sel ON public.luc_provisioning_jobs FOR SELECT TO authenticated USING (luc_is_staff(auth.uid(), tenant_id));
CREATE POLICY luc_push_sel ON public.luc_push_registrations FOR SELECT TO authenticated USING (luc_is_staff(auth.uid(), tenant_id));
CREATE POLICY luc_audit_sel ON public.luc_audit_events FOR SELECT TO authenticated USING ((tenant_id IS NOT NULL AND luc_has_role(auth.uid(), tenant_id, 'tenant_admin')) OR luc_is_platform_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.luc_devices, public.luc_call_events, public.luc_recordings FROM authenticated;
REVOKE INSERT, DELETE ON public.luc_voicemails FROM authenticated;

CREATE OR REPLACE FUNCTION public.luc_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; tid uuid; BEGIN
  r := COALESCE(NEW, OLD);
  BEGIN tid := (to_jsonb(r)->>'tenant_id')::uuid; EXCEPTION WHEN others THEN tid := NULL; END;
  IF TG_TABLE_NAME = 'luc_tenants' THEN tid := (to_jsonb(r)->>'id')::uuid; END IF;
  INSERT INTO luc_audit_events(tenant_id, actor_id, action, entity, entity_id) VALUES (tid, auth.uid(), lower(TG_OP), TG_TABLE_NAME, to_jsonb(r)->>'id');
  RETURN r; END $$;
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['luc_tenants','luc_memberships','luc_devices','luc_pbx_connections','luc_extension_mappings','luc_feature_flags','luc_contacts','luc_conversations','luc_messages','luc_voicemails','luc_recordings','luc_provisioning_jobs','luc_push_registrations'] LOOP
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.luc_audit()', t||'_audit', t);
END LOOP; END $$;