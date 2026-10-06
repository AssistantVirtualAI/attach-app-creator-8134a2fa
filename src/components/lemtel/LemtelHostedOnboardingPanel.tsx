import { useMemo, useState } from 'react';
import { Building2, Loader2, MailPlus, UsersRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type Locale = 'fr' | 'en';
type Role = 'admin' | 'member';
type Invitee = { email: string; displayName: string; role: Role; locale: Locale };
const slugify = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

function parseBulk(value: string, fallbackLocale: Locale): Invitee[] | Error {
  const rows = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!rows.length) return new Error('Add at least one user.');
  if (rows.length > 200) return new Error('A maximum of 200 users can be provisioned at one time.');
  const seen = new Set<string>();
  const users: Invitee[] = [];
  for (const row of rows) {
    const [rawEmail, rawName, rawRole = 'member', rawLocale = fallbackLocale] = row.split(',').map((part) => part.trim());
    const email = rawEmail?.toLowerCase();
    const role = rawRole === 'admin' ? 'admin' : rawRole === 'member' ? 'member' : null;
    const locale = rawLocale === 'en' ? 'en' : rawLocale === 'fr' ? 'fr' : null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !rawName || !role || !locale || seen.has(email)) return new Error(`Invalid or duplicate row: ${row}`);
    seen.add(email);
    users.push({ email, displayName: rawName.slice(0, 160), role, locale });
  }
  return users;
}

export default function LemtelHostedOnboardingPanel() {
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [defaultLocale, setDefaultLocale] = useState<Locale>('fr');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerLocale, setOwnerLocale] = useState<Locale>('fr');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [bulkUsers, setBulkUsers] = useState('');
  const [busy, setBusy] = useState<'organization' | 'users' | null>(null);
  const targetSlug = organizationSlug || slugify(organizationName);
  const parsedUsers = useMemo(() => parseBulk(bulkUsers, defaultLocale), [bulkUsers, defaultLocale]);

  const createOrganization = async () => {
    if (!organizationName.trim() || !targetSlug || !ownerName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      toast.error('Organization name, URL slug, owner name, and owner email are required.');
      return;
    }
    setBusy('organization');
    try {
      const { data, error } = await supabase.functions.invoke('lemtel-onboarding-admin', {
        body: {
          action: 'create_organization',
          organization: { displayName: organizationName.trim(), slug: targetSlug, defaultLocale },
          owner: { email: ownerEmail.trim().toLowerCase(), displayName: ownerName.trim(), role: 'owner', locale: ownerLocale },
          users: [],
        },
      });
      if (error || !(data as any)?.organization?.id) throw new Error((data as any)?.error || error?.message || 'Organization onboarding failed');
      setOrganizationId((data as any).organization.id);
      const owner = (data as any).owner;
      toast.success(owner?.delivered ? 'Organization created and welcome email sent.' : 'Organization created. Welcome email delivery needs attention.');
    } catch (cause: any) {
      toast.error(cause?.message || 'Organization onboarding failed');
    } finally { setBusy(null); }
  };

  const provisionUsers = async () => {
    if (!organizationId) { toast.error('Create the organization and owner first.'); return; }
    if (parsedUsers instanceof Error) { toast.error(parsedUsers.message); return; }
    setBusy('users');
    try {
      const { data, error } = await supabase.functions.invoke('lemtel-onboarding-admin', { body: { action: 'provision_users', organizationId, users: parsedUsers } });
      if (error || (data as any)?.ok !== true) throw new Error((data as any)?.error || error?.message || 'User onboarding failed');
      const results = (data as any).users || [];
      const delivered = results.filter((item: any) => item.delivered).length;
      const failed = results.length - delivered;
      setBulkUsers('');
      toast.success(failed ? `${delivered} welcome email(s) sent; ${failed} need attention.` : `${delivered} welcome email(s) sent.`);
    } catch (cause: any) {
      toast.error(cause?.message || 'User onboarding failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6 w-full max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Building2 className="w-7 h-7" /> Lemtel organizations</h1>
        <p className="text-muted-foreground mt-1">Email-only onboarding. No extension, SIP domain, magic link, or manual application credential is shown here.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Create an organization and its owner</CardTitle><CardDescription>The owner receives an email in their selected language with download links and a one-time temporary password.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label>Organization name</Label><Input value={organizationName} onChange={(event) => { setOrganizationName(event.target.value); if (!organizationSlug) setOrganizationSlug(slugify(event.target.value)); }} placeholder="Example Communications" /></div>
          <div className="space-y-2"><Label>Organization URL slug</Label><Input value={targetSlug} onChange={(event) => setOrganizationSlug(slugify(event.target.value))} placeholder="example-communications" /></div>
          <LocaleSelect label="Organization language" value={defaultLocale} onChange={setDefaultLocale} />
          <div />
          <div className="space-y-2"><Label>Owner full name</Label><Input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="Alex Tremblay" /></div>
          <div className="space-y-2"><Label>Owner email</Label><Input type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} placeholder="admin@example.com" /></div>
          <LocaleSelect label="Owner welcome email" value={ownerLocale} onChange={setOwnerLocale} />
          <div className="flex items-end"><Button onClick={createOrganization} disabled={busy !== null} className="w-full">{busy === 'organization' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MailPlus className="w-4 h-4 mr-2" />}Create and send welcome email</Button></div>
        </CardContent>
      </Card>
      <Card className={organizationId ? '' : 'opacity-60'}>
        <CardHeader><CardTitle className="flex items-center gap-2"><UsersRound className="w-5 h-5" /> Add users one by one or in bulk</CardTitle><CardDescription>One line per user: <code>email, full name, member|admin, fr|en</code>. The role and language are required for every recipient.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <textarea className="w-full min-h-40 rounded-md border bg-background px-3 py-2 text-sm font-mono" value={bulkUsers} onChange={(event) => setBulkUsers(event.target.value)} placeholder={'maria@example.com, Maria Roy, member, fr\nchris@example.com, Chris Lee, admin, en'} disabled={!organizationId || busy !== null} />
          {bulkUsers && parsedUsers instanceof Error && <p className="text-sm text-destructive">{parsedUsers.message}</p>}
          <Button onClick={provisionUsers} disabled={!organizationId || busy !== null || parsedUsers instanceof Error}>{busy === 'users' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MailPlus className="w-4 h-4 mr-2" />}Provision users and send welcome emails</Button>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Temporary passwords are generated only by the server and never shown in this portal. Every recipient must choose a personal password in the Lemtel application before use.</p>
    </div>
  );
}

function LocaleSelect({ label, value, onChange }: { label: string; value: Locale; onChange: (value: Locale) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><Select value={value} onValueChange={(next) => onChange(next as Locale)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fr">Français</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></div>;
}
