-- Lemtel self-hosted schema package — OFFLINE ONLY; do not apply without a separate target-write approval.
-- Creates empty Lemtel-owned structures only. It neither imports shared data nor creates Auth users, buckets, objects or functions.

CREATE TABLE IF NOT EXISTS public.lemtel_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT lemtel_organizations_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  CONSTRAINT lemtel_organizations_status_check CHECK (status IN ('active', 'archived'))
);

CREATE TABLE IF NOT EXISTS public.lemtel_organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT lemtel_memberships_role_check CHECK (role IN ('owner', 'admin', 'member')),
  CONSTRAINT lemtel_memberships_status_check CHECK (status IN ('active', 'suspended'))
);

CREATE OR REPLACE FUNCTION public.lemtel_is_active_member(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lemtel_organization_memberships AS membership
    WHERE membership.organization_id = target_organization_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.lemtel_is_active_admin(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lemtel_organization_memberships AS membership
    WHERE membership.organization_id = target_organization_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'admin')
  );
$$;

CREATE TABLE IF NOT EXISTS public.lemtel_mobile_config_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  channel text NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  messages jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_version text,
  recommended_version text,
  maintenance_mode boolean NOT NULL DEFAULT false,
  maintenance_message text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES auth.users(id),
  published_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT lemtel_mobile_config_channel_check CHECK (channel IN ('staging', 'production')),
  CONSTRAINT lemtel_mobile_config_revision_check CHECK (revision > 0),
  CONSTRAINT lemtel_mobile_config_status_check CHECK (status IN ('draft', 'published', 'retired')),
  CONSTRAINT lemtel_mobile_config_publish_state_check CHECK (
    (status = 'published' AND published_at IS NOT NULL AND published_by IS NOT NULL) OR status <> 'published'
  ),
  CONSTRAINT lemtel_mobile_config_revision_key UNIQUE (organization_id, channel, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS lemtel_mobile_config_one_published_per_channel
  ON public.lemtel_mobile_config_revisions (organization_id, channel)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.lemtel_mobile_release_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  platform text NOT NULL,
  channel text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  artifact_key text NOT NULL,
  artifact_sha256 text NOT NULL,
  artifact_size_bytes bigint NOT NULL,
  native_version_min text,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_by uuid REFERENCES auth.users(id),
  activated_at timestamptz,
  rolled_back_at timestamptz,
  CONSTRAINT lemtel_mobile_release_platform_check CHECK (platform IN ('ios', 'android')),
  CONSTRAINT lemtel_mobile_release_channel_check CHECK (channel IN ('staging', 'production')),
  CONSTRAINT lemtel_mobile_release_status_check CHECK (status IN ('draft', 'active', 'retired')),
  CONSTRAINT lemtel_mobile_release_key_check CHECK (artifact_key ~ '^releases/[a-z0-9-]+/(ios|android)/(staging|production)/[^/]+\\.zip$'),
  CONSTRAINT lemtel_mobile_release_sha256_check CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT lemtel_mobile_release_size_check CHECK (artifact_size_bytes > 0),
  CONSTRAINT lemtel_mobile_release_version_key UNIQUE (organization_id, platform, channel, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS lemtel_mobile_release_one_active_per_target
  ON public.lemtel_mobile_release_artifacts (organization_id, platform, channel)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.lemtel_mobile_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_mobile_admin_audit_action_check CHECK (action IN ('config_drafted', 'config_published', 'config_retired', 'release_registered', 'release_activated', 'release_retired')),
  CONSTRAINT lemtel_mobile_admin_audit_subject_check CHECK (subject_type IN ('config_revision', 'release_artifact'))
);

CREATE INDEX IF NOT EXISTS lemtel_memberships_user_idx
  ON public.lemtel_organization_memberships (user_id, organization_id);
CREATE INDEX IF NOT EXISTS lemtel_mobile_config_lookup_idx
  ON public.lemtel_mobile_config_revisions (organization_id, channel, status, revision DESC);
CREATE INDEX IF NOT EXISTS lemtel_mobile_release_lookup_idx
  ON public.lemtel_mobile_release_artifacts (organization_id, platform, channel, status, created_at DESC);
CREATE INDEX IF NOT EXISTS lemtel_mobile_admin_audit_lookup_idx
  ON public.lemtel_mobile_admin_audit (organization_id, created_at DESC);

REVOKE ALL ON public.lemtel_organizations FROM anon, authenticated;
REVOKE ALL ON public.lemtel_organization_memberships FROM anon, authenticated;
REVOKE ALL ON public.lemtel_mobile_config_revisions FROM anon, authenticated;
REVOKE ALL ON public.lemtel_mobile_release_artifacts FROM anon, authenticated;
REVOKE ALL ON public.lemtel_mobile_admin_audit FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.lemtel_is_active_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lemtel_is_active_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lemtel_is_active_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_is_active_admin(uuid) TO authenticated;
GRANT SELECT ON public.lemtel_organizations TO authenticated;
GRANT SELECT ON public.lemtel_organization_memberships TO authenticated;
GRANT SELECT ON public.lemtel_mobile_config_revisions TO authenticated;
GRANT SELECT ON public.lemtel_mobile_release_artifacts TO authenticated;
GRANT SELECT ON public.lemtel_mobile_admin_audit TO authenticated;

ALTER TABLE public.lemtel_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_mobile_config_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_mobile_release_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_mobile_admin_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY lemtel_organizations_select_member
  ON public.lemtel_organizations
  FOR SELECT TO authenticated
  USING (public.lemtel_is_active_member(id));

CREATE POLICY lemtel_memberships_select_self
  ON public.lemtel_organization_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY lemtel_mobile_config_select_published
  ON public.lemtel_mobile_config_revisions
  FOR SELECT TO authenticated
  USING (status = 'published' AND public.lemtel_is_active_member(organization_id));

CREATE POLICY lemtel_mobile_release_select_active
  ON public.lemtel_mobile_release_artifacts
  FOR SELECT TO authenticated
  USING (status = 'active' AND public.lemtel_is_active_member(organization_id));

CREATE POLICY lemtel_mobile_admin_audit_select_admin
  ON public.lemtel_mobile_admin_audit
  FOR SELECT TO authenticated
  USING (public.lemtel_is_active_admin(organization_id));

COMMENT ON TABLE public.lemtel_mobile_config_revisions IS
  'Lemtel-owned mobile configuration revisions. Empty schema only; no shared configuration is imported.';
COMMENT ON TABLE public.lemtel_mobile_release_artifacts IS
  'Lemtel-owned release metadata. Artifact bucket and object lifecycle require a separate approved design.';
COMMENT ON TABLE public.lemtel_mobile_admin_audit IS
  'Append-only Lemtel administrative audit metadata; payloads must remain minimized and non-secret.';
