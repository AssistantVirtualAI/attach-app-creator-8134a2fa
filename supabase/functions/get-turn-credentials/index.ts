// Lemtel TURN issuer. No relay password is stored in source code or returned
// to anonymous callers; the upstream provider key stays server-side.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const errorResponse = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: jsonHeaders });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return errorResponse(405, 'method_not_allowed');
  const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '')?.[1];
  if (!jwt || jwt === req.headers.get('apikey')) return errorResponse(401, 'auth_required');

  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !publicKey) return errorResponse(503, 'auth_not_configured');
  try {
    const client = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await client.auth.getUser(jwt);
    if (error || !user) return errorResponse(401, 'auth_required');
    // RLS must allow only the authenticated user's own softphone row.
    const { data: softphone, error: rowError } = await client.from('pbx_softphone_users')
      .select('id').eq('portal_user_id', user.id).limit(1).maybeSingle();
    if (rowError || !softphone) return errorResponse(403, 'softphone_access_required');

    const apiKey = Deno.env.get('METERED_API_KEY');
    const appName = Deno.env.get('METERED_APP_NAME') || 'lemtel';
    if (!apiKey || !/^[a-z0-9-]+$/i.test(appName)) return errorResponse(503, 'turn_not_configured');
    const remote = await fetch(
      `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!remote.ok) return errorResponse(503, 'turn_unavailable');
    const servers = await remote.json();
    if (!Array.isArray(servers) || !servers.length) return errorResponse(503, 'turn_unavailable');
    return new Response(JSON.stringify(servers), { headers: jsonHeaders });
  } catch {
    return errorResponse(503, 'turn_unavailable');
  }
});
